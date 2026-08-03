import { expect, test } from 'vitest';
import { resolveAvailabilitySettingsById } from './settings';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { validateConfig, type WhenConfiguration } from '@when/config';

test('per-event settings flow through', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.meetings['30-min-chat'].start_times_every_minutes = 15;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('per-event setting defaults to duration_minutes if unset', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.meetings['30-min-chat'].start_times_every_minutes;
	cfg.meetings['30-min-chat'].duration_minutes = 45;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(45);
});

// The default is the loader's job, not the consumer's: omitting it in when.yaml is
// what a writer actually does, and validateConfig fills it before anyone reads it.
test('notice_minutes defaults to 120 when the config omits it', () => {
	const raw = JSON.parse(JSON.stringify(validConfig));
	delete raw.meetings['30-min-chat'].notice_minutes;
	const cfg = validateConfig(raw);
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').minimum_notice).toBe(120);
});

test('throws on unknown meeting name', () => {
	expect(() => resolveAvailabilitySettingsById(validConfig, 'nope')).toThrow(/unknown meeting/);
});

test('the default length leads and granularity falls back to the shortest offered', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.meetings['30-min-chat'].start_times_every_minutes;
	cfg.meetings['30-min-chat'].duration_minutes = 30;
	cfg.meetings['30-min-chat'].additional_duration_minutes = [15, 60];
	const settings = resolveAvailabilitySettingsById(cfg, '30-min-chat');
	expect(settings.duration).toBe(30);
	expect(settings.slot_granularity).toBe(15); // shortest offered
});

test('weekly schedule is expanded from the schedule rules', () => {
	const day = [{ from: '09:00', to: '17:00' }];
	expect(resolveAvailabilitySettingsById(validConfig, '30-min-chat').weekly).toEqual({
		mon: day,
		tue: day,
		wed: day,
		thu: day,
		fri: day
	});
});
