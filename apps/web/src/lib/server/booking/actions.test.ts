import { describe, expect, test } from 'vitest';
import { resolveBookingActions } from './actions';
import type { AppointmentStatus } from '$lib/server/db';

const startTime = '2026-05-01T15:00:00Z';
const before = new Date('2026-05-01T14:00:00Z');
const noticeBoundary = new Date('2026-05-01T14:30:00Z'); // 30 min before start
const atStart = new Date(startTime);
const after = new Date('2026-05-01T15:30:00Z');

function row(status: AppointmentStatus) {
	return { status, start_time: startTime };
}

const eventTypeNoNotice = { minimum_notice: 0 };
const eventType30 = { minimum_notice: 30 };

describe('cancel', () => {
	test('allowed for confirmed before start', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: true });
	});

	test('allowed for pending before start', () => {
		const a = resolveBookingActions({
			row: row('pending'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: true });
	});

	test('past_start at exact start_time', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: atStart,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: false, reason: 'past_start' });
	});

	test('past_start after start_time', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: after,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: false, reason: 'past_start' });
	});

	test('terminal_status for cancelled (even before start)', () => {
		const a = resolveBookingActions({
			row: row('cancelled'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: false, reason: 'terminal_status' });
	});

	test('terminal_status for declined', () => {
		const a = resolveBookingActions({
			row: row('declined'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.cancel).toEqual({ allowed: false, reason: 'terminal_status' });
	});
});

describe('reschedule', () => {
	test('allowed when notice satisfied', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: before,
			eventType: eventType30
		});
		expect(a.reschedule).toEqual({ allowed: true });
	});

	test('allowed at exact notice boundary', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: noticeBoundary,
			eventType: eventType30
		});
		expect(a.reschedule).toEqual({ allowed: true });
	});

	test('minimum_notice when inside notice window', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: new Date('2026-05-01T14:45:00Z'),
			eventType: eventType30
		});
		expect(a.reschedule).toEqual({ allowed: false, reason: 'minimum_notice' });
	});

	test('past_start beats minimum_notice when clock is past start', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: after,
			eventType: eventType30
		});
		expect(a.reschedule).toEqual({ allowed: false, reason: 'past_start' });
	});

	test('terminal_status for cancelled', () => {
		const a = resolveBookingActions({
			row: row('cancelled'),
			viewer: 'attendee',
			now: before,
			eventType: eventType30
		});
		expect(a.reschedule).toEqual({ allowed: false, reason: 'terminal_status' });
	});

	test('missing eventType defaults minimum_notice to 0', () => {
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: noticeBoundary,
			eventType: undefined
		});
		expect(a.reschedule).toEqual({ allowed: true });
	});
});

describe('accept / decline', () => {
	test('allowed for organizer + pending + before start', () => {
		const a = resolveBookingActions({
			row: row('pending'),
			viewer: 'organizer',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.accept).toEqual({ allowed: true });
		expect(a.decline).toEqual({ allowed: true });
	});

	test('wrong_viewer for attendee regardless of status', () => {
		const a = resolveBookingActions({
			row: row('pending'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.accept).toEqual({ allowed: false, reason: 'wrong_viewer' });
		expect(a.decline).toEqual({ allowed: false, reason: 'wrong_viewer' });
	});

	test('terminal_status for organizer + non-pending status', () => {
		for (const status of ['confirmed', 'cancelled', 'declined'] as const) {
			const a = resolveBookingActions({
				row: row(status),
				viewer: 'organizer',
				now: before,
				eventType: eventTypeNoNotice
			});
			expect(a.accept).toEqual({ allowed: false, reason: 'terminal_status' });
			expect(a.decline).toEqual({ allowed: false, reason: 'terminal_status' });
		}
	});

	test('past_start for organizer + pending after start_time', () => {
		const a = resolveBookingActions({
			row: row('pending'),
			viewer: 'organizer',
			now: after,
			eventType: eventTypeNoNotice
		});
		expect(a.accept).toEqual({ allowed: false, reason: 'past_start' });
		expect(a.decline).toEqual({ allowed: false, reason: 'past_start' });
	});

	test('wrong_viewer takes precedence over status', () => {
		// attendee viewing a confirmed booking — wrong_viewer, not terminal_status
		const a = resolveBookingActions({
			row: row('confirmed'),
			viewer: 'attendee',
			now: before,
			eventType: eventTypeNoNotice
		});
		expect(a.accept).toEqual({ allowed: false, reason: 'wrong_viewer' });
	});
});
