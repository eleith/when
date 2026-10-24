import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	openDb,
	replaceCalendarBusy,
	runMigrations,
	withWriteTransaction,
	type NewAppointment
} from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { hasAppointmentConflict } from './conflicts';

const meeting = {
	...validConfig.meetings['30-min-chat'],
	booking_calendar: 'booking',
	additional_busy_calendars: ['extra', 'booking', 'extra']
};
const interval = {
	start: Temporal.Instant.from('2099-01-04T15:07:00Z'),
	end: Temporal.Instant.from('2099-01-04T16:07:00Z')
};

let db: ReturnType<typeof openDb>;

async function seed(changes: Partial<NewAppointment> = {}) {
	await db
		.insertInto('appointments')
		.values({
			id: 'other',
			event_type_id: '30-min-chat',
			start_time: '2099-01-04T15:45:00Z',
			end_time: '2099-01-04T16:30:00Z',
			guest_name: 'Guest',
			status: 'confirmed',
			cancel_token: 'other-token',
			location: null,
			note: null,
			video_chat: null,
			external_event_id: null,
			external_calendar_id: null,
			...changes
		})
		.execute();
}

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

describe('hasAppointmentConflict: local actual intervals', () => {
	test.each(['pending', 'confirmed'] as const)('blocks an overlapping %s row', async (status) => {
		await seed({ status });
		const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(busy).toBe(true);
	});

	test('blocks other meeting types, even one no longer configured', async () => {
		await seed({ event_type_id: 'removed-meeting' });
		const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(busy).toBe(true);
	});

	test('includes a three-day appointment starting far before the candidate day', async () => {
		await seed({ start_time: '2099-01-01T16:00:00Z', end_time: '2099-01-04T16:00:00Z' });
		const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(busy).toBe(true);
	});

	test.each(['declined', 'cancelled', 'expired', 'rescheduled', 'purged'] as const)(
		'ignores overlapping inactive status %s',
		async (status) => {
			await seed({ status });
			const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
			expect(busy).toBe(false);
		}
	);

	test('excludes only the supplied appointment ID, not all rows of its type', async () => {
		await seed({ id: 'self', cancel_token: 'self-token' });
		const selfOnly = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(selfOnly).toBe(false);
		await seed({ start_time: '2099-01-04T15:50:00Z' });
		const otherRow = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(otherRow).toBe(true);
	});

	test.each([
		['ends at candidate start', '2099-01-04T14:00:00Z', '2099-01-04T15:07:00Z'],
		['starts at candidate end', '2099-01-04T16:07:00Z', '2099-01-04T17:00:00Z'],
		['is earlier', '2099-01-04T13:00:00Z', '2099-01-04T14:00:00Z'],
		['is later', '2099-01-04T17:00:00Z', '2099-01-04T18:00:00Z']
	])('allows a local row that %s', async (_name, start_time, end_time) => {
		await seed({ start_time, end_time });
		const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(busy).toBe(false);
	});
});

describe('hasAppointmentConflict: local remote-busy mirror', () => {
	test.each(['booking', 'extra'])(
		'blocks actual busy time in the %s calendar',
		async (calendar) => {
			await replaceCalendarBusy(db, calendar, [
				{ start: '2099-01-04T16:00:00Z', end: '2099-01-04T17:00:00Z' }
			]);
			const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
			expect(busy).toBe(true);
		}
	);

	test('ignores a busy calendar not selected by the supplied meeting', async () => {
		await replaceCalendarBusy(db, 'unselected', [
			{ start: interval.start.toString(), end: interval.end.toString() }
		]);
		const free = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(free).toBe(false);
		const selectedMeeting = { ...meeting, additional_busy_calendars: ['unselected'] };
		const busy = await hasAppointmentConflict(db, selectedMeeting, interval, 'self');
		expect(busy).toBe(true);
	});

	test.each([
		['ends at start', '2099-01-04T14:00:00Z', '2099-01-04T15:07:00Z'],
		['starts at end', '2099-01-04T16:07:00Z', '2099-01-04T17:00:00Z'],
		['outside the window', '2099-01-05T15:00:00Z', '2099-01-05T16:00:00Z']
	])('allows mirrored busy time that %s', async (_name, start, end) => {
		await replaceCalendarBusy(db, 'booking', [{ start, end }]);
		const busy = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(busy).toBe(false);
	});

	test('uses the supplied actual interval, not the configured default duration', async () => {
		await replaceCalendarBusy(db, 'booking', [
			{ start: '2099-01-04T16:30:00Z', end: '2099-01-04T17:00:00Z' }
		]);
		const short = await hasAppointmentConflict(db, meeting, interval, 'self');
		const extended = await hasAppointmentConflict(
			db,
			meeting,
			{ ...interval, end: interval.start.add({ minutes: 120 }) },
			'self'
		);
		expect(short).toBe(false);
		expect(extended).toBe(true);
	});

	test('reads a replacement mirror without fetching a provider', async () => {
		await replaceCalendarBusy(db, 'booking', [
			{ start: interval.start.toString(), end: interval.end.toString() }
		]);
		const before = await hasAppointmentConflict(db, meeting, interval, 'self');
		await replaceCalendarBusy(db, 'booking', []);
		const after = await hasAppointmentConflict(db, meeting, interval, 'self');
		expect(before).toBe(true);
		expect(after).toBe(false);
	});
});

test('uses the supplied write connection for both local and mirror reads without reacquiring root', async () => {
	await replaceCalendarBusy(db, 'booking', [
		{ start: interval.start.toString(), end: interval.end.toString() }
	]);
	const rootRead = vi.spyOn(db, 'selectFrom');
	const rootConnection = vi.spyOn(db, 'connection');
	await withWriteTransaction(db, async (connection) => {
		rootRead.mockImplementation(() => {
			throw new Error('root read inside reserved connection');
		});
		rootConnection.mockImplementation(() => {
			throw new Error('root connection reacquired');
		});
		const busy = await hasAppointmentConflict(connection, meeting, interval, 'self');
		expect(busy).toBe(true);
	});
	expect(rootRead).not.toHaveBeenCalled();
	expect(rootConnection).toHaveBeenCalledTimes(1);
});

test('sees an uncommitted local row on the supplied connection', async () => {
	const rollback = new Error('discard fixture write');
	const write = withWriteTransaction(db, async (connection) => {
		await connection
			.insertInto('appointments')
			.values({
				id: 'inside',
				event_type_id: 'another-type',
				status: 'pending',
				cancel_token: 'inside-token',
				start_time: interval.start.toString(),
				end_time: interval.end.toString(),
				guest_name: 'Guest',
				location: null,
				note: null,
				video_chat: null,
				external_event_id: null,
				external_calendar_id: null
			})
			.execute();
		const busy = await hasAppointmentConflict(connection, meeting, interval, 'self');
		expect(busy).toBe(true);
		throw rollback;
	});
	await expect(write).rejects.toBe(rollback);
	const afterRollback = await hasAppointmentConflict(db, meeting, interval, 'self');
	expect(afterRollback).toBe(false);
});
