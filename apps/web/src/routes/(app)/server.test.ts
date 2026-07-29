import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Meeting, WhenConfiguration } from '@when/config';

const h = vi.hoisted(() => ({
	cfg: { current: null as unknown as WhenConfiguration }
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => h.cfg.current }));

import { load } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

const baseMeeting: Meeting = {
	name: 'chat',
	slug: 'chat',
	duration_minutes: 30,
	booking_approval: 'instant',
	booking_calendar: 'my-google-cal',
	schedule: 'standard'
};

function withMeetings(...meetings: Meeting[]) {
	h.cfg.current = { ...validConfig, meetings };
}

// $types widens the load result to Record<string, any>, so restate the payload we assert on.
type ListedEventType = {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	durations: number[];
};

function loadEventTypes(): ListedEventType[] {
	return (load({} as Parameters<typeof load>[0]) as LoadResult).eventTypes;
}

beforeEach(() => {
	h.cfg.current = validConfig;
});

describe('home page load', () => {
	test('never exposes a meeting location or video chat service', () => {
		withMeetings({
			...baseMeeting,
			location: '1 Main St, Suite 200',
			video_chat_service: 'google-service'
		});

		const [et] = loadEventTypes();
		expect(et).not.toHaveProperty('location');
		expect(et).not.toHaveProperty('video_chat_service');
		expect(JSON.stringify(et)).not.toContain('Main St');
	});

	test('normalizes a scalar duration into a list', () => {
		withMeetings({ ...baseMeeting, duration_minutes: 30 });

		expect(loadEventTypes()[0].durations).toEqual([30]);
	});

	test('sorts offered lengths ascending regardless of config order', () => {
		withMeetings({ ...baseMeeting, duration_minutes: [60, 15, 30] });

		expect(loadEventTypes()[0].durations).toEqual([15, 30, 60]);
	});

	test('de-duplicates repeated lengths', () => {
		withMeetings({ ...baseMeeting, duration_minutes: [60, 30, 60] });

		expect(loadEventTypes()[0].durations).toEqual([30, 60]);
	});

	test('hides private meetings', () => {
		withMeetings(
			{ ...baseMeeting, name: 'public-chat', slug: 'public-chat' },
			{ ...baseMeeting, name: 'secret', slug: 'secret', visibility: 'unlisted' }
		);

		expect(loadEventTypes().map((et) => et.slug)).toEqual(['public-chat']);
	});

	test('treats an unset visibility as public', () => {
		withMeetings(baseMeeting);

		expect(loadEventTypes()).toHaveLength(1);
	});
});
