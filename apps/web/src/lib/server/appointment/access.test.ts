import { describe, expect, test, vi } from 'vitest';
import {
	APPOINTMENT_VIEW_GRACE_DAYS,
	isCancelAllowed,
	isRescheduleAllowed,
	isViewable,
	isViewAllowed
} from './access';
import type { Appointment } from '@when/db';

let chainTip: Appointment | null = null;
const findChainTip = vi.fn(async () => chainTip);
vi.mock('@when/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@when/db')>()),
	findChainTip: () => findChainTip()
}));

const db = {} as never;

const baseRow: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	guest_timezone: null,
	location: null,
	note: null,
	video_chat: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	cancel_token: 'tok-abc',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: null,
	created_at: '',
	updated_at: ''
};

const DAY_MS = 24 * 60 * 60 * 1000;

function rescheduledLog(rowId: string, at: string): string {
	return JSON.stringify([
		{
			action: 'reschedule',
			actor: 'guest',
			at,
			payload: { metadata: { previous_id: rowId, next_id: 'next' } }
		}
	]);
}

describe('isViewable', () => {
	test('true before end_time', () => {
		expect(isViewable(baseRow, new Date('2026-05-01T14:00:00Z'))).toBe(true);
	});

	test('true within grace window', () => {
		const now = new Date(Date.parse(baseRow.end_time) + (APPOINTMENT_VIEW_GRACE_DAYS - 1) * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(true);
	});

	test('false at exact grace boundary', () => {
		const now = new Date(Date.parse(baseRow.end_time) + APPOINTMENT_VIEW_GRACE_DAYS * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(false);
	});

	test('false past grace window', () => {
		const now = new Date(Date.parse(baseRow.end_time) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(false);
	});

	test('a superseded row measures its window from the move, not its old slot', () => {
		const movedAt = '2026-04-01T00:00:00Z';
		const row = {
			...baseRow,
			status: 'rescheduled' as const,
			action_log: rescheduledLog(baseRow.id, movedAt)
		};

		const inside = new Date(Date.parse(movedAt) + (APPOINTMENT_VIEW_GRACE_DAYS - 1) * DAY_MS);
		const outside = new Date(Date.parse(movedAt) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS);

		expect(isViewable(row, inside)).toBe(true);
		// Still before end_time + grace, so the old rule would have kept this open.
		expect(Date.parse(baseRow.end_time)).toBeGreaterThan(outside.getTime());
		expect(isViewable(row, outside)).toBe(false);
	});

	test('a superseded row expires even when its old slot is months away', () => {
		const movedAt = '2026-01-01T00:00:00Z';
		const row = {
			...baseRow,
			end_time: '2026-06-01T15:30:00Z',
			status: 'rescheduled' as const,
			action_log: rescheduledLog(baseRow.id, movedAt)
		};

		const later = new Date(Date.parse(movedAt) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS);
		expect(isViewable(row, later)).toBe(false);
	});

	test('a rescheduled row with no recorded move is not viewable', () => {
		const row = { ...baseRow, status: 'rescheduled' as const, action_log: null };
		expect(isViewable(row, new Date('2026-05-01T14:00:00Z'))).toBe(false);
	});
});

describe('isCancelAllowed', () => {
	test('true for confirmed before start', () => {
		expect(isCancelAllowed(baseRow, new Date('2026-05-01T14:00:00Z'))).toBe(true);
	});

	test('true for pending before start', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'pending' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(true);
	});

	test('false at exact start_time', () => {
		expect(isCancelAllowed(baseRow, new Date(baseRow.start_time))).toBe(false);
	});

	test('false after start_time', () => {
		expect(isCancelAllowed(baseRow, new Date('2026-05-01T15:30:00Z'))).toBe(false);
	});

	test('false for cancelled', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'cancelled' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(false);
	});

	test('false for declined', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'declined' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(false);
	});
});

describe('isRescheduleAllowed', () => {
	test('true when notice window is satisfied', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T13:00:00Z'), 60)).toBe(true);
	});

	test('true at exact notice boundary', () => {
		// minimum_notice = 60min; now + 60min === start_time → allowed
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T14:00:00Z'), 60)).toBe(true);
	});

	test('false inside notice window', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T14:30:00Z'), 60)).toBe(false);
	});

	test('false for terminal status', () => {
		expect(
			isRescheduleAllowed({ ...baseRow, status: 'declined' }, new Date('2026-05-01T13:00:00Z'), 60)
		).toBe(false);
	});

	test('zero minimum_notice still requires now <= start', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T15:00:00Z'), 0)).toBe(true);
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T15:00:01Z'), 0)).toBe(false);
	});
});

describe('isViewAllowed', () => {
	const now = new Date('2026-05-01T14:00:00Z');

	test('allows a row its own token', async () => {
		await expect(isViewAllowed(db, baseRow, 'tok-abc', now)).resolves.toBe(true);
	});

	test('allows terminal statuses through (the caller decides what to render)', async () => {
		const cancelled = { ...baseRow, status: 'cancelled' as const };
		await expect(isViewAllowed(db, cancelled, 'tok-abc', now)).resolves.toBe(true);
		const declined = { ...baseRow, status: 'declined' as const };
		await expect(isViewAllowed(db, declined, 'tok-abc', now)).resolves.toBe(true);
	});

	test('refuses a missing token', async () => {
		await expect(isViewAllowed(db, baseRow, null, now)).resolves.toBe(false);
	});

	test('refuses a token mismatch', async () => {
		await expect(isViewAllowed(db, baseRow, 'wrong', now)).resolves.toBe(false);
	});

	test('refuses a row past its grace window', async () => {
		const past = new Date(
			Date.parse(baseRow.end_time) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS
		);
		await expect(isViewAllowed(db, baseRow, 'tok-abc', past)).resolves.toBe(false);
	});

	test('refuses a purged appointment even with a valid token', async () => {
		const purged = { ...baseRow, status: 'purged' as const };
		await expect(isViewAllowed(db, purged, 'tok-abc', now)).resolves.toBe(false);
	});
});

describe('isViewAllowed with the chain tip token', () => {
	const now = new Date('2026-05-01T14:00:00Z');
	const superseded: Appointment = {
		...baseRow,
		id: 'old',
		status: 'rescheduled',
		action_log: rescheduledLog('old', '2026-04-28T00:00:00Z')
	};
	const tip: Appointment = {
		...baseRow,
		id: 'tip',
		cancel_token: 'tok-tip',
		end_time: '2026-06-01T15:30:00Z'
	};

	test("the tip's token opens a superseded row it grew out of", async () => {
		chainTip = tip;
		await expect(isViewAllowed(db, superseded, 'tok-tip', now)).resolves.toBe(true);
	});

	test("the tip's token stops working once the tip's own window closes", async () => {
		chainTip = tip;
		const past = new Date(Date.parse(tip.end_time) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS);
		await expect(isViewAllowed(db, superseded, 'tok-tip', past)).resolves.toBe(false);
	});

	test('the tip token still opens a row whose own token has already expired', async () => {
		const movedAt = '2026-04-01T00:00:00Z';
		const expired = {
			...superseded,
			action_log: rescheduledLog('old', movedAt)
		};
		const afterOwnWindow = new Date(
			Date.parse(movedAt) + (APPOINTMENT_VIEW_GRACE_DAYS + 1) * DAY_MS
		);
		chainTip = tip;

		await expect(isViewAllowed(db, expired, 'tok-abc', afterOwnWindow)).resolves.toBe(false);
		await expect(isViewAllowed(db, expired, 'tok-tip', afterOwnWindow)).resolves.toBe(true);
	});

	test('a sibling token that is not the tip stays locked out', async () => {
		chainTip = tip;
		await expect(isViewAllowed(db, superseded, 'tok-sibling', now)).resolves.toBe(false);
	});

	test('a live row never asks the database for a tip it already is', async () => {
		chainTip = tip;
		findChainTip.mockClear();

		await expect(isViewAllowed(db, baseRow, 'tok-tip', now)).resolves.toBe(false);

		expect(findChainTip).not.toHaveBeenCalled();
	});

	test('a chain with no tip refuses everything but the row own token', async () => {
		chainTip = null;
		await expect(isViewAllowed(db, superseded, 'tok-tip', now)).resolves.toBe(false);
		await expect(isViewAllowed(db, superseded, 'tok-abc', now)).resolves.toBe(true);
	});
});
