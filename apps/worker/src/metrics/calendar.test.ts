import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { sql } from 'kysely';
import { findCalendar, type WhenConfiguration } from '@when/config';
import { fetchBusyIntervals, pushAppointment, deleteAppointmentFromCalendar } from '@when/calendar';
import { openDb, runMigrations, findAppointment } from '@when/db';
import { refreshCalendar, reconcileAppointment } from '../services/calendar.js';
import { scanOnce } from '../services/calendar-scan.js';
import {
	pushAppointment as write,
	deleteAppointmentFromCalendar as remove
} from '../services/calendar-provider.js';
import { refreshCalendars } from '../calendar/refresh.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { createLogger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import {
	calendarRefreshTotal,
	calendarSyncDuration,
	calendarSyncTotal,
	operationFailuresTotal
} from './registry.js';

vi.mock('@when/calendar', async (importOriginal) => ({
	...(await importOriginal<typeof import('@when/calendar')>()),
	fetchBusyIntervals: vi.fn(),
	pushAppointment: vi.fn(),
	deleteAppointmentFromCalendar: vi.fn()
}));

const config = {
	...sampleConfig,
	providers: {
		dav: {
			type: 'caldav',
			url: 'https://calendar.example.test',
			username: 'u',
			password: 'p',
			calendars: { work: { href: '/calendar', sync: { refresh_every_minutes: 10 } } }
		}
	},
	meetings: {
		'30-min': {
			title: 'Chat',
			booking_calendar: 'work',
			additional_busy_calendars: [],
			booking_window_days: 60
		}
	}
} as unknown as WhenConfiguration;
const cal = findCalendar(config, 'work')!;
const now = Temporal.Instant.from('2026-01-01T00:00:00Z');
const window = { start: now, end: now.add({ hours: 24 }) };
let ctx: WorkerContext;

beforeEach(async () => {
	vi.resetAllMocks();
	calendarRefreshTotal.reset();
	calendarSyncDuration.reset();
	calendarSyncTotal.reset();
	operationFailuresTotal.reset();
	const db = openDb(':memory:');
	await runMigrations(db);
	ctx = { db, config, logger: createLogger(), mailer: { send: async () => ({ ok: true }) } };
	vi.mocked(fetchBusyIntervals).mockResolvedValue([]);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await ctx.db.destroy();
});

test('batch refreshes count each provider failure and completed refresh, skipping fresh calendars', async () => {
	vi.mocked(fetchBusyIntervals)
		.mockRejectedValueOnce(new Error('offline'))
		.mockRejectedValueOnce(new Error('offline'));
	for (let pass = 0; pass < 4; pass++) await refreshCalendars(ctx, { now });
	expect(fetchBusyIntervals).toHaveBeenCalledTimes(3);
	expect((await operationFailuresTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { operation: 'calendar_refresh', code: 'provider_error' },
			value: 2
		})
	]);
	expect((await calendarRefreshTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { calendar_id: 'work', provider_type: 'caldav', status: 'failure' },
			value: 2
		}),
		expect.objectContaining({
			labels: { calendar_id: 'work', provider_type: 'caldav', status: 'success' },
			value: 1
		})
	]);
});

test.each(['mirror', 'status'])(
	'refresh %s SQL failure is not a provider failure',
	async (stage) => {
		if (stage === 'mirror') {
			await ctx.db
				.insertInto('external_calendar_busy')
				.values({
					calendar_id: 'work',
					start_time: now.toString(),
					end_time: window.end.toString()
				})
				.execute();
			await sql`create trigger fail_mirror before delete on external_calendar_busy begin select raise(abort, 'local SQL failure'); end`.execute(
				ctx.db
			);
		} else {
			await sql`create trigger fail_status before insert on service_status begin select raise(abort, 'local SQL failure'); end`.execute(
				ctx.db
			);
		}
		await expect(refreshCalendar(ctx, cal, window)).rejects.toThrow('local SQL failure');
		expect((await operationFailuresTotal.get()).values).toEqual([]);
		expect((await calendarRefreshTotal.get()).values).toEqual([]);
	}
);

test('a failed fetch is counted even when persisting its service outcome fails', async () => {
	vi.mocked(fetchBusyIntervals).mockRejectedValue(new Error('offline'));
	await sql`create trigger fail_status before insert on service_status begin select raise(abort, 'local SQL failure'); end`.execute(
		ctx.db
	);
	await expect(refreshCalendar(ctx, cal, window)).rejects.toThrow('local SQL failure');
	expect((await operationFailuresTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { operation: 'calendar_refresh', code: 'provider_error' },
			value: 1
		})
	]);
	expect((await calendarRefreshTotal.get()).values).toEqual([]);
});

test('observer errors are not reclassified as provider errors', async () => {
	const error = new Error('metric unavailable');
	vi.spyOn(calendarRefreshTotal, 'inc').mockImplementationOnce(() => {
		throw error;
	});
	await expect(refreshCalendar(ctx, cal, window)).rejects.toBe(error);
	expect((await operationFailuresTotal.get()).values).toEqual([]);
	const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
	expect(statuses).toHaveLength(2);
	expect(statuses.every((status) => status.error === null)).toBe(true);
});

test('scan loops observe each reconciliation retry even when failure logs deduplicate', async () => {
	await ctx.db
		.insertInto('appointments')
		.values({ ...sampleAppointment, calendar_revision: 1 })
		.execute();
	vi.mocked(pushAppointment)
		.mockResolvedValueOnce({ ok: false, reason: 'offline' })
		.mockResolvedValueOnce({ ok: false, reason: 'offline' })
		.mockResolvedValueOnce({ ok: true, externalCalendarId: 'work', externalEventId: 'remote' });
	for (let pass = 0; pass < 3; pass++) await scanOnce(ctx);
	expect(pushAppointment).toHaveBeenCalledTimes(3);
	expect((await operationFailuresTotal.get()).values).toEqual([
		expect.objectContaining({
			labels: { operation: 'calendar_write', code: 'provider_error' },
			value: 2
		})
	]);
	expect((await calendarSyncTotal.get()).values).toEqual([
		expect.objectContaining({ labels: { status: 'success' }, value: 3 })
	]);
	expect(
		(await calendarSyncDuration.get()).values.filter((value) =>
			value.metricName?.endsWith('_count')
		)
	).toEqual([expect.objectContaining({ labels: { provider_type: 'caldav' }, value: 3 })]);
});

test('a successful calendar write followed by a DB failure is not a provider failure', async () => {
	await ctx.db.insertInto('appointments').values(sampleAppointment).execute();
	const row = (await findAppointment(ctx.db, sampleAppointment.id))!;
	vi.mocked(pushAppointment).mockResolvedValue({
		ok: true,
		externalCalendarId: 'work',
		externalEventId: 'remote'
	});
	await sql`create trigger fail_reference before update on appointments begin select raise(abort, 'local SQL failure'); end`.execute(
		ctx.db
	);
	await expect(reconcileAppointment(ctx, row)).rejects.toThrow('local SQL failure');
	expect((await operationFailuresTotal.get()).values).toEqual([]);
	expect(
		(await calendarSyncDuration.get()).values.find((value) => value.metricName?.endsWith('_count'))
			?.value
	).toBe(1);
});

test.each(['work', 'removed'])(
	'calendar adapter APIs distinguish provider and config failures for %s',
	async (calendarId) => {
		vi.mocked(pushAppointment).mockResolvedValue({ ok: false, reason: 'private detail' });
		vi.mocked(deleteAppointmentFromCalendar).mockResolvedValue({
			ok: false,
			reason: 'private detail'
		});
		await write(config, sampleAppointment, calendarId, {
			cancelUrl: 'https://when.example.test/booked'
		});
		await remove(config, calendarId, 'remote');
		const code = calendarId === 'work' ? 'provider_error' : 'not_configured';
		expect((await operationFailuresTotal.get()).values).toEqual([
			expect.objectContaining({ labels: { operation: 'calendar_write', code }, value: 1 }),
			expect.objectContaining({ labels: { operation: 'calendar_delete', code }, value: 1 })
		]);
	}
);
