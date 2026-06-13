import { describe, expect, test } from 'vitest';
import type { EventType } from '@when/config';
import { deriveBrand, eventTypeName, fmtWhen } from './format.js';
import { sampleAppointment, sampleConfig } from './__fixtures__/booking.js';

describe('format', () => {
	test('eventTypeName prefers the event type name, falls back to the id', () => {
		expect(eventTypeName({ name: '30 Minute Chat' } as EventType, sampleAppointment)).toBe(
			'30 Minute Chat'
		);
		expect(eventTypeName(undefined, sampleAppointment)).toBe('30-min');
	});

	test('fmtWhen renders a human range with weekday and timezone', () => {
		const s = fmtWhen('2026-01-05T15:00:00Z', '2026-01-05T15:30:00Z', 'America/New_York');
		expect(s).toMatch(/Mon/);
		expect(s).toContain('–');
		expect(s).toContain('GMT');
	});

	test('deriveBrand pulls the name and primary color', () => {
		expect(deriveBrand(sampleConfig)).toEqual({
			name: 'Acme Scheduling',
			primaryColor: '#2563eb'
		});
	});

	const withBranding = (branding: Record<string, unknown>) =>
		({
			...sampleConfig,
			user: { ...sampleConfig.user, branding }
		}) as typeof sampleConfig;

	test('deriveBrand keeps an absolute image URL as-is', () => {
		expect(deriveBrand(withBranding({ logo_url: 'https://cdn.acme.test/logo.png' })).logoUrl).toBe(
			'https://cdn.acme.test/logo.png'
		);
	});

	test('deriveBrand resolves a relative image URL against the public app base', () => {
		// sampleConfig.url.app is https://when.example.com
		expect(deriveBrand(withBranding({ logo_url: '/brand/logo.png' })).logoUrl).toBe(
			'https://when.example.com/brand/logo.png'
		);
	});

	test('deriveBrand falls back to avatar_url when no logo_url is set', () => {
		expect(deriveBrand(withBranding({ avatar_url: 'https://cdn.acme.test/me.jpg' })).logoUrl).toBe(
			'https://cdn.acme.test/me.jpg'
		);
	});

	test('deriveBrand has no image when neither logo nor avatar is configured', () => {
		expect(deriveBrand(withBranding({})).logoUrl).toBeUndefined();
	});
});
