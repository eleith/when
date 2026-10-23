import { expect, test } from 'vitest';
import {
	resolveAvailabilityLimits,
	resolveAvailabilitySettings,
	resolveAvailabilitySettingsById
} from './settings';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { validateConfig, type WhenConfiguration } from '@when/config';

test('per-event settings flow through', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.meetings['30-min-chat'].start_times_every_minutes = 15;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat', 'guest').slot_granularity).toBe(15);
});

test('the step defaults to 30 and does not follow duration_minutes', () => {
	const raw = JSON.parse(JSON.stringify(validConfig));
	delete raw.meetings['30-min-chat'].start_times_every_minutes;
	raw.meetings['30-min-chat'].duration_minutes = 45;
	const cfg = validateConfig(raw);
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat', 'guest').slot_granularity).toBe(30);
});

// The default is the loader's job, not the consumer's: omitting it in when.yaml is
// what a writer actually does, and validateConfig fills it before anyone reads it.
test('notice_minutes defaults to 120 when the config omits it', () => {
	const raw = JSON.parse(JSON.stringify(validConfig));
	delete raw.meetings['30-min-chat'].notice_minutes;
	const cfg = validateConfig(raw);
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat', 'guest').minimum_notice).toBe(120);
});

test('throws on unknown meeting name', () => {
	expect(() => resolveAvailabilitySettingsById(validConfig, 'nope', 'guest')).toThrow(
		/unknown meeting/
	);
});

test('the default length leads and no offered length changes the step', () => {
	const raw = JSON.parse(JSON.stringify(validConfig));
	delete raw.meetings['30-min-chat'].start_times_every_minutes;
	raw.meetings['30-min-chat'].duration_minutes = 30;
	raw.meetings['30-min-chat'].additional_duration_minutes = [15, 60];
	const cfg = validateConfig(raw);
	const settings = resolveAvailabilitySettingsById(cfg, '30-min-chat', 'guest');
	expect(settings.duration).toBe(30);
	expect(settings.slot_granularity).toBe(30);
});

test('weekly schedule is expanded from the schedule rules', () => {
	const day = [{ from: '09:00', to: '17:00' }];
	expect(resolveAvailabilitySettingsById(validConfig, '30-min-chat', 'guest').weekly).toEqual({
		mon: day,
		tue: day,
		wed: day,
		thu: day,
		fri: day
	});
});

test('host settings differ from guest settings only in buffers and daily limit without mutating config', () => {
	const cfg = structuredClone(validConfig);
	const meeting = cfg.meetings['30-min-chat'];
	meeting.padding_before_minutes = 15;
	meeting.padding_after_minutes = 10;
	meeting.daily_booking_limit = 1;
	meeting.start_times_every_minutes = 15;
	meeting.notice_minutes = 90;
	meeting.booking_window_days = 12;
	meeting.additional_duration_minutes = [15, 60];
	const original = structuredClone(cfg);
	const day = [{ from: '09:00', to: '17:00' }];

	const guest = resolveAvailabilitySettings(cfg, meeting, 'guest');
	const host = resolveAvailabilitySettings(cfg, meeting, 'host');

	expect(guest).toEqual({
		duration: 30,
		slot_granularity: 15,
		minimum_notice: 90,
		maximum_lookahead: 12,
		buffer_before: 15,
		buffer_after: 10,
		max_appointments_per_day: 1,
		weekly: { mon: day, tue: day, wed: day, thu: day, fri: day }
	});
	expect(host).toEqual({
		...guest,
		buffer_before: 0,
		buffer_after: 0,
		max_appointments_per_day: null
	});
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat', 'guest')).toEqual(guest);
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat', 'host')).toEqual(host);
	expect(resolveAvailabilityLimits(meeting, 'guest')).toEqual({
		buffer_before: 15,
		buffer_after: 10,
		max_appointments_per_day: 1
	});
	expect(resolveAvailabilityLimits(meeting, 'host')).toEqual({
		buffer_before: 0,
		buffer_after: 0,
		max_appointments_per_day: null
	});
	expect(resolveAvailabilitySettings(cfg, meeting, 'guest')).toEqual(guest);
	expect(cfg).toEqual(original);
});
