import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	findAppointment,
	openDb,
	parseActionLog,
	runMigrations,
	type Appointment,
	type AppointmentUpdate
} from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { getGoogleEvent, patchGoogleEvent, pushAppointment } from '@when/calendar';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';
import {
	bookVideoChatEvent,
	publishVideoChat,
	readPendingVideoChat,
	requestMissingVideoChat,
	videoChatAdapter,
	videoChatResource,
	wantsGeneratedVideoChat,
	type VideoChatAttempt
} from './video-chat.js';
import type { WorkerContext } from './context.js';
import { createLogger } from './logger.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';

vi.mock('@when/video-chat', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/video-chat')>();
	return { ...actual, getVideoChatAdapter: vi.fn() };
});
vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return {
		...actual,
		getGoogleEvent: vi.fn(),
		patchGoogleEvent: vi.fn(),
		pushAppointment: vi.fn()
	};
});

const url = 'https://cloud.example.com/call/room';
const now = '2026-01-02T10:00:00.000Z';
let ctx: WorkerContext;
let adapter: VideoChatAdapter;

function configuration(): WhenConfiguration {
	return {
		...sampleConfig,
		providers: {
			nc: {
				type: 'nextcloud',
				url: 'https://cloud.example.com',
				username: 'u',
				password: 'p',
				calendars: {}
			},
			google: {
				type: 'google',
				client_id: 'id',
				client_secret: 'secret',
				refresh_token: 'token',
				calendars: { work: { id: 'primary' } }
			},
			dav: {
				type: 'caldav',
				url: 'https://dav.example.com',
				username: 'u',
				password: 'p',
				calendars: {}
			}
		},
		meetings: {
			chat: {
				title: 'Chat',
				booking_calendar: 'work',
				video_chat: { provider: 'nc', attach: { auto: true } }
			}
		}
	} as unknown as WhenConfiguration;
}

function appointment(patch: Partial<Appointment> = {}): Appointment {
	return {
		...sampleAppointment,
		id: 'a',
		event_type_id: 'chat',
		calendar_revision: 4,
		ics_sequence: 7,
		...patch
	};
}

async function seed(patch: Partial<Appointment> = {}) {
	await ctx.db.insertInto('appointments').values(appointment(patch)).execute();
}

async function update(patch: AppointmentUpdate) {
	await ctx.db.updateTable('appointments').set(patch).where('id', '=', 'a').execute();
}

async function row() {
	const current = await findAppointment(ctx.db, 'a');
	if (!current) throw new Error('Missing test appointment');
	return current;
}

function readyAttempt(current: Appointment): VideoChatAttempt {
	const resource = videoChatResource(ctx.config, current);
	if (!resource) throw new Error('Missing test resource');
	return {
		target: {
			appointmentId: current.id,
			revision: current.calendar_revision,
			resource
		},
		status: 'ready',
		url
	};
}

beforeEach(async () => {
	vi.resetAllMocks();
	const db = openDb(':memory:');
	await runMigrations(db);
	ctx = { db, config: configuration(), logger: createLogger(), mailer: { send: vi.fn() } };
	adapter = {
		read: vi.fn().mockResolvedValue({ ok: true, status: 'absent' }),
		request: vi.fn().mockResolvedValue({ ok: true, status: 'ready', url }),
		removeLink: vi.fn()
	};
	vi.mocked(getVideoChatAdapter).mockReturnValue(adapter);
});
afterEach(async () => {
	await ctx.db.destroy();
});

describe('standing generation choice and resource selection', () => {
	test.each([
		{ choice: null, automatic: true, wanted: true },
		{ choice: null, automatic: false, wanted: false },
		{ choice: 'generate', automatic: true, wanted: true },
		{ choice: 'generate', automatic: false, wanted: true },
		{ choice: 'suppress', automatic: true, wanted: false },
		{ choice: 'suppress', automatic: false, wanted: false }
	] as const)('$choice with auto=$automatic => $wanted', ({ choice, automatic, wanted }) => {
		ctx.config.meetings.chat.video_chat!.attach = { auto: automatic };
		expect(wantsGeneratedVideoChat(ctx.config, appointment({ video_chat_request: choice }))).toBe(
			wanted
		);
	});

	test('automatic rules use guest answers, while an explicit request overrides a nonmatch', () => {
		ctx.config.meetings.chat.video_chat!.attach = { when: [{ field: 'where', equals: 'Video' }] };
		const matching = JSON.stringify([
			{ name: 'where', label: 'Where?', type: 'choice', value: 'Video' }
		]);
		expect(wantsGeneratedVideoChat(ctx.config, appointment({ guest_answers: matching }))).toBe(
			true
		);
		expect(wantsGeneratedVideoChat(ctx.config, appointment())).toBe(false);
		expect(
			wantsGeneratedVideoChat(ctx.config, appointment({ video_chat_request: 'generate' }))
		).toBe(true);
	});

	test.each(['declined', 'cancelled', 'expired', 'rescheduled', 'purged'] as const)(
		'%s never wants generation',
		(status) => {
			expect(
				wantsGeneratedVideoChat(ctx.config, appointment({ status, video_chat_request: 'generate' }))
			).toBe(false);
		}
	);

	test('existing URI and missing/unsupported providers override a generate request', () => {
		const forced = appointment({ video_chat_request: 'generate' });
		expect(wantsGeneratedVideoChat(ctx.config, { ...forced, video_chat: url })).toBe(false);
		ctx.config.meetings.chat.video_chat!.provider = 'dav';
		expect(wantsGeneratedVideoChat(ctx.config, forced)).toBe(false);
		ctx.config.meetings.chat.video_chat!.provider = 'missing';
		expect(wantsGeneratedVideoChat(ctx.config, forced)).toBe(false);
		delete ctx.config.meetings.chat.video_chat;
		expect(wantsGeneratedVideoChat(ctx.config, forced)).toBe(false);
	});

	test('Nextcloud ignores calendar metadata; Google binds the exact event', () => {
		const booked = appointment({
			external_calendar_id: 'work',
			external_event_id: 'event',
			video_chat: url
		});
		expect(videoChatResource(ctx.config, booked)).toEqual({
			providerName: 'nc',
			calendarEvent: null,
			url
		});
		ctx.config.meetings.chat.video_chat!.provider = 'google';
		expect(videoChatResource(ctx.config, booked)).toEqual({
			providerName: 'google',
			calendarEvent: { calendarId: 'work', eventId: 'event' },
			url
		});
		expect(videoChatResource(ctx.config, appointment())).toEqual({
			providerName: 'google',
			calendarEvent: null,
			url: null
		});
	});
});

describe('provider observation and booking', () => {
	test.each(['ready', 'pending'] as const)(
		'observed %s is reused without a create',
		async (status) => {
			await seed();
			vi.mocked(adapter.read).mockResolvedValue(
				status === 'ready' ? { ok: true, status, url } : { ok: true, status }
			);
			const result = await requestMissingVideoChat(ctx, 'a', 'request-uuid');
			expect(result).toMatchObject({ status, url: status === 'ready' ? url : null });
			expect(adapter.read).toHaveBeenCalledWith(null);
			expect(adapter.request).not.toHaveBeenCalled();
			const current = await row();
			expect(current.video_chat).toBeNull();
			expect(current.calendar_revision).toBe(4);
		}
	);

	test('only observed absence permits creating, using the checkpointed request UUID', async () => {
		await seed();
		const result = await requestMissingVideoChat(ctx, 'a', 'request-uuid');
		expect(result).toMatchObject({ status: 'ready', url, target: { revision: 4 } });
		expect(adapter.request).toHaveBeenCalledExactlyOnceWith({
			name: 'Meeting: Jane Doe',
			requestId: 'request-uuid'
		});
		expect(vi.mocked(adapter.read).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(adapter.request).mock.invocationCallOrder[0]
		);
	});

	test('a host suppression during observation prevents the subsequent create', async () => {
		await seed();
		vi.mocked(adapter.read).mockImplementation(async () => {
			await update({ video_chat_request: 'suppress' });
			return { ok: true, status: 'absent' };
		});
		const result = await requestMissingVideoChat(ctx, 'a', 'request-uuid');
		expect(result).toBeNull();
		expect(adapter.request).not.toHaveBeenCalled();
		const current = await row();
		expect(current.video_chat_request).toBe('suppress');
	});

	test.each(['failed', 'ambiguous'] as const)(
		'observed %s throws rather than creating',
		async (status) => {
			await seed();
			vi.mocked(adapter.read).mockResolvedValue({ ok: true, status });
			const request = requestMissingVideoChat(ctx, 'a', 'request-uuid');
			await expect(request).rejects.toThrow(status);
			expect(adapter.request).not.toHaveBeenCalled();
		}
	);

	test.each(['pending', 'absent', 'failed'] as const)(
		'pending reader stays read-only even when observation is %s',
		async (status) => {
			await seed();
			const current = await row();
			const attempt = { ...readyAttempt(current), status: 'pending' as const, url: null };
			vi.mocked(adapter.read)
				.mockResolvedValueOnce({ ok: true, status })
				.mockResolvedValueOnce({ ok: true, status: 'ready', url });
			const reading = readPendingVideoChat(ctx, attempt);
			await expect(reading).rejects.toThrow(status);
			const ready = await readPendingVideoChat(ctx, attempt);
			expect(ready).toEqual({ ...attempt, status: 'ready', url });
			expect(adapter.read).toHaveBeenCalledTimes(2);
			expect(adapter.request).not.toHaveBeenCalled();
		}
	);

	test.each(['pending', 'confirmed'] as const)(
		'Google without an event is deferred for request (%s)',
		async (status) => {
			ctx.config.meetings.chat.video_chat!.provider = 'google';
			await seed({ status });
			const requested = await requestMissingVideoChat(ctx, 'a', 'uuid');
			expect(requested).toBeNull();
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
		}
	);

	test('pending Google does not book; confirmed Google returns provider evidence without writing the reference', async () => {
		ctx.config.meetings.chat.video_chat!.provider = 'google';
		await seed({ status: 'pending' });
		const deferred = await bookVideoChatEvent(ctx, 'a');
		expect(deferred).toBeNull();
		expect(pushAppointment).not.toHaveBeenCalled();
		await update({ status: 'confirmed' });
		vi.mocked(pushAppointment).mockResolvedValue({
			ok: true,
			externalCalendarId: 'work',
			externalEventId: 'event'
		});
		const booked = await bookVideoChatEvent(ctx, 'a');
		expect(booked).toEqual({ reference: { calendarId: 'work', eventId: 'event' }, created: true });
		const current = await row();
		expect(current.external_event_id).toBeNull();
		expect(current.calendar_revision).toBe(4);
	});

	test('Google adapter is wired to the bound event and configured calendar, not an implicit generation mode', () => {
		const resource = {
			providerName: 'google',
			calendarEvent: { calendarId: 'work', eventId: 'event' },
			url: null
		};
		videoChatAdapter(ctx, resource);
		const [, port] = vi.mocked(getVideoChatAdapter).mock.calls[0];
		expect(port?.id).toBe('event');
		port!.read();
		port!.patch({ summary: 'updated' }, { conferenceDataVersion: '1' });
		expect(getGoogleEvent).toHaveBeenCalledWith(
			expect.objectContaining({ google_calendar_id: 'primary' }),
			'event'
		);
		expect(patchGoogleEvent).toHaveBeenCalledWith(
			expect.objectContaining({ google_calendar_id: 'primary' }),
			'event',
			{ summary: 'updated' },
			{ conferenceDataVersion: '1' }
		);
		expect(() => videoChatAdapter(ctx, { ...resource, calendarEvent: null })).toThrow(
			'already-booked'
		);
	});
});

describe('guarded SQL publication', () => {
	test.each([
		{ status: 'pending', url: null },
		{ status: 'ready', url: null },
		{ status: 'ready', url: '' }
	] as const)('does not publish an incomplete result ($status, $url)', async (result) => {
		await seed();
		const initial = await row();
		const published = await publishVideoChat(ctx, { ...readyAttempt(initial), ...result }, now);
		const current = await row();
		expect(published).toBeNull();
		expect(current).toEqual(initial);
	});

	test.each([
		{ choice: null, actor: 'system', status: 'confirmed' },
		{ choice: 'generate', actor: 'host', status: 'pending' }
	] as const)(
		'$choice materialization increments C and ICS exactly once, attributed to $actor',
		async ({ choice, actor, status }) => {
			await seed({ video_chat_request: choice, status });
			const initial = await row();
			const attempt = readyAttempt(initial);
			const published = await publishVideoChat(ctx, attempt, now);
			const replayed = await publishVideoChat(ctx, attempt, now);
			expect(published).toBe(8);
			expect(replayed).toEqual(published);
			const current = await row();
			expect(current).toMatchObject({
				video_chat: url,
				calendar_revision: 5,
				ics_sequence: 8,
				video_chat_request: choice
			});
			expect(parseActionLog(current.action_log)).toEqual([
				{
					action: 'edit',
					actor,
					at: now,
					payload: { metadata: { changes: ['video_chat_added'] } }
				}
			]);
			expect(adapter.request).not.toHaveBeenCalled();
		}
	);

	test.each([
		{ label: 'stale C', change: { calendar_revision: 5 } },
		{ label: 'suppression', change: { video_chat_request: 'suppress' } },
		{ label: 'current URI wins', change: { video_chat: 'https://chosen.example.com' } },
		...(['cancelled', 'declined', 'expired', 'rescheduled', 'purged'] as const).map((status) => ({
			label: status,
			change: { status }
		}))
	] satisfies { label: string; change: AppointmentUpdate }[])(
		'rejects $label without modifying any row field',
		async ({ change }) => {
			await seed();
			const initial = await row();
			const attempt = readyAttempt(initial);
			await update(change);
			const before = await row();
			const published = await publishVideoChat(ctx, attempt, now);
			const after = await row();
			expect(published).toBeNull();
			expect(after).toEqual(before);
		}
	);

	test('deleted appointment cannot be resurrected by publication', async () => {
		await seed();
		const initial = await row();
		await ctx.db.deleteFrom('appointments').where('id', '=', 'a').execute();
		const published = await publishVideoChat(ctx, readyAttempt(initial), now);
		expect(published).toBeNull();
	});

	test('Nextcloud does not require a calendar and metadata repair does not invalidate its target', async () => {
		await seed();
		const initial = await row();
		const attempt = readyAttempt(initial);
		await update({
			external_calendar_id: 'repaired',
			external_event_id: 'new-event',
			calendar_synced_revision: 4
		});
		const published = await publishVideoChat(ctx, attempt, now);
		expect(published).toBe(8);
		const current = await row();
		expect(current).toMatchObject({
			video_chat: url,
			external_event_id: 'new-event',
			calendar_revision: 5
		});
	});

	test.each(['external_calendar_id', 'external_event_id'] as const)(
		'Google rejects a changed %s binding even at the same C',
		async (field) => {
			ctx.config.meetings.chat.video_chat!.provider = 'google';
			await seed({ external_calendar_id: 'work', external_event_id: 'event' });
			const initial = await row();
			const attempt = readyAttempt(initial);
			await update({ [field]: 'replacement' });
			const published = await publishVideoChat(ctx, attempt, now);
			expect(published).toBeNull();
			const current = await row();
			expect(current.video_chat).toBeNull();
		}
	);

	test.each(['rule', 'provider', 'meeting'] as const)(
		'rechecks current %s configuration instead of trusting the old target',
		async (change) => {
			await seed();
			const initial = await row();
			const attempt = readyAttempt(initial);
			if (change === 'rule') ctx.config.meetings.chat.video_chat!.attach = { auto: false };
			if (change === 'provider') ctx.config.meetings.chat.video_chat!.provider = 'google';
			if (change === 'meeting') delete ctx.config.meetings.chat;
			const published = await publishVideoChat(ctx, attempt, now);
			expect(published).toBeNull();
			const current = await row();
			expect(current).toEqual(initial);
		}
	);

	test('uses current ICS sequence when a separate email version changed without a C change', async () => {
		await seed();
		const initial = await row();
		const attempt = readyAttempt(initial);
		await update({ ics_sequence: 12 });
		const published = await publishVideoChat(ctx, attempt, now);
		expect(published).toBe(13);
		const current = await row();
		expect(current).toMatchObject({ calendar_revision: 5, ics_sequence: 13 });
	});
});
