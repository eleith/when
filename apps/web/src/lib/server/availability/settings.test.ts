import { expect, test } from 'vitest';
import { resolveAvailabilitySettingsById } from './settings';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { WhenConfiguration } from '@when/config';

test('per-event settings flow through', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.meetings[0].start_times_every_minutes = 15;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('per-event setting defaults to duration_minutes if unset', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.meetings[0].start_times_every_minutes;
	cfg.meetings[0].duration_minutes = 45;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(45);
});

test('notice_minutes defaults to 120 if unset', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.meetings[0].notice_minutes;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').minimum_notice).toBe(120);
});

test('throws on unknown meeting name', () => {
	expect(() => resolveAvailabilitySettingsById(validConfig, 'nope')).toThrow(/unknown meeting/);
});

test('weekly schedule comes from schedule definition', () => {
	expect(resolveAvailabilitySettingsById(validConfig, '30-min-chat').weekly).toEqual(
		validConfig.schedules[0].weekly
	);
});
