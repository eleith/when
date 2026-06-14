import { expect, test } from 'vitest';
import { resolveAvailabilitySettingsById } from './settings';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { WhenConfiguration } from '@when/config';

test('per-event override wins over global default', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.availability.slot_granularity = 30;
	cfg.event_types[0].slot_granularity = 15;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('global default flows through when event has no override', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.availability.minimum_notice = 60;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').minimum_notice).toBe(60);
});

test('hardcoded fallback when neither global nor event sets it', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.availability.slot_granularity;
	delete cfg.event_types[0].slot_granularity;
	expect(resolveAvailabilitySettingsById(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('throws on unknown event type id', () => {
	expect(() => resolveAvailabilitySettingsById(validConfig, 'nope')).toThrow(/unknown event_type/);
});

test('weekly schedule comes from global default', () => {
	expect(resolveAvailabilitySettingsById(validConfig, '30-min-chat').weekly).toEqual(
		validConfig.availability.default
	);
});
