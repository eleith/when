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
	...validConfig.meetings[0],
	name: 'chat',
	slug: 'chat'
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

function loadHome(session: unknown = null): Promise<LoadResult> {
	return load({
		locals: { auth: vi.fn().mockResolvedValue(session) }
	} as unknown as Parameters<typeof load>[0]) as Promise<LoadResult>;
}

async function loadEventTypes(): Promise<ListedEventType[]> {
	return (await loadHome()).eventTypes;
}

beforeEach(() => {
	h.cfg.current = validConfig;
});

describe('home page load', () => {
	test('never exposes a meeting location or video chat provider', async () => {
		withMeetings({
			...baseMeeting,
			location: '1 Main St, Suite 200',
			video_chat_provider: 'google-service'
		});

		const [et] = await loadEventTypes();
		expect(et).not.toHaveProperty('location');
		expect(et).not.toHaveProperty('video_chat_provider');
		expect(JSON.stringify(et)).not.toContain('Main St');
	});

	test('normalizes a scalar duration into a list', async () => {
		withMeetings({ ...baseMeeting, duration_minutes: 30 });

		expect((await loadEventTypes())[0].durations).toEqual([30]);
	});

	test('sorts offered lengths ascending regardless of config order', async () => {
		withMeetings({ ...baseMeeting, duration_minutes: 60, additional_duration_minutes: [15, 30] });

		expect((await loadEventTypes())[0].durations).toEqual([15, 30, 60]);
	});

	test('de-duplicates repeated lengths', async () => {
		withMeetings({ ...baseMeeting, duration_minutes: 60, additional_duration_minutes: [30, 60] });

		expect((await loadEventTypes())[0].durations).toEqual([30, 60]);
	});

	test('hides private meetings', async () => {
		withMeetings(
			{ ...baseMeeting, name: 'public-chat', slug: 'public-chat' },
			{ ...baseMeeting, name: 'secret', slug: 'secret', visibility: 'unlisted' }
		);

		expect((await loadEventTypes()).map((et) => et.slug)).toEqual(['public-chat']);
	});

	test('treats an unset visibility as public', async () => {
		withMeetings(baseMeeting);

		expect(await loadEventTypes()).toHaveLength(1);
	});

	test('flags a signed-in host so the page can offer the admin nav', async () => {
		expect((await loadHome({ user: { name: 'host' } })).isAdmin).toBe(true);
	});

	test('leaves a guest unflagged', async () => {
		expect((await loadHome()).isAdmin).toBe(false);
	});
});
