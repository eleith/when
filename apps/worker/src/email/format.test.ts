import { describe, expect, test } from 'vitest';
import type { Meeting } from '@when/config';
import { deriveBrand, eventTypeName, fmtWhen } from './format.js';
import { sampleAppointment, sampleConfig } from './__fixtures__/appointment.js';

describe('format', () => {
	test('eventTypeName prefers the meeting title, falls back to the id', () => {
		expect(eventTypeName({ title: '30 Minute Chat' } as Meeting, sampleAppointment)).toBe(
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

	test('deriveBrand pulls the name and primary color, no image without a cid', () => {
		expect(deriveBrand(sampleConfig)).toEqual({
			name: 'Acme Scheduling',
			pageTitle: 'if not now, when?',
			primaryColor: '#2563eb',
			onPrimary: '#ffffff',
			logoUrl: undefined
		});
	});

	test('deriveBrand picks dark text on a light brand color', () => {
		const cfg = {
			...sampleConfig,
			user: {
				...sampleConfig.user,
				appearance: {
					...sampleConfig.user.appearance,
					primary_light_color: '#fde047'
				}
			}
		} as typeof sampleConfig;
		expect(deriveBrand(cfg).onPrimary).toBe('#1a1a1a');
	});

	test('deriveBrand references the embedded logo by cid when one was fetched', () => {
		expect(deriveBrand(sampleConfig, 'brand-logo').logoUrl).toBe('cid:brand-logo');
	});
});
