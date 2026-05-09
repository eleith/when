import { expect, test } from 'bun:test';
import { resolveKnobs } from '../../src/lib/server/availability/knobs';
import { validConfig } from '../fixtures/valid-config';
import type { WhenConfiguration } from '../../src/lib/server/config/schema';

test('per-event override wins over global default', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.availability.slot_granularity = 30;
	cfg.event_types[0].slot_granularity = 15;
	expect(resolveKnobs(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('global default flows through when event has no override', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.availability.minimum_notice = 60;
	expect(resolveKnobs(cfg, '30-min-chat').minimum_notice).toBe(60);
});

test('hardcoded fallback when neither global nor event sets it', () => {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	delete cfg.availability.slot_granularity;
	delete cfg.event_types[0].slot_granularity;
	expect(resolveKnobs(cfg, '30-min-chat').slot_granularity).toBe(15);
});

test('throws on unknown event type id', () => {
	expect(() => resolveKnobs(validConfig, 'nope')).toThrow(/unknown event_type/);
});

test('weekly schedule comes from global default', () => {
	expect(resolveKnobs(validConfig, '30-min-chat').weekly).toEqual(validConfig.availability.default);
});
