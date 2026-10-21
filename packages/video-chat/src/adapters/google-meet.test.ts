import { describe, expect, test, vi } from 'vitest';
import { GoogleMeetAdapter, type GoogleEventPort, type VideoChatResult } from '../index.js';

const eventId = 'event/id?';
const video = { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' };
const ready = { id: eventId, conferenceData: { entryPoints: [video] } };
const pending = {
	id: eventId,
	conferenceData: {
		createRequest: { requestId: 'echoed-id', status: { statusCode: 'pending' } },
		entryPoints: [video]
	}
};

function fakeEvent(response: unknown) {
	return {
		id: eventId,
		read: vi.fn<GoogleEventPort['read']>().mockResolvedValue(response),
		patch: vi.fn<GoogleEventPort['patch']>().mockResolvedValue(response)
	};
}

describe('GoogleMeetAdapter.read', () => {
	test('ready is serializable and does not require echoed request metadata', async () => {
		const event = fakeEvent(ready);
		const adapter = new GoogleMeetAdapter(event);

		const result = await adapter.read(null);

		expect(result).toEqual({ ok: true, status: 'ready', url: video.uri });
		expect(event.read).toHaveBeenCalledTimes(1);
		expect(event.patch).not.toHaveBeenCalled();
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
	test.each<[string, unknown, VideoChatResult]>([
		['pending overrides stale video entry points', pending, { ok: true, status: 'pending' }],
		['missing conference data', { id: eventId }, { ok: true, status: 'absent' }],
		['null conference data', { id: eventId, conferenceData: null }, { ok: true, status: 'absent' }],
		[
			'explicit failure overrides stale video entry points',
			{
				id: eventId,
				conferenceData: {
					createRequest: { status: { statusCode: 'failure' } },
					entryPoints: [video]
				}
			},
			{ ok: true, status: 'failed' }
		],
		['missing event identity', {}, { ok: true, status: 'ambiguous' }],
		['wrong event identity', { ...ready, id: 'other-event' }, { ok: true, status: 'ambiguous' }],
		['empty event identity', { id: '' }, { ok: true, status: 'ambiguous' }],
		['cancelled event', { id: eventId, status: 'cancelled' }, { ok: true, status: 'ambiguous' }],
		[
			'cancelled event with a stale link',
			{ ...ready, status: 'cancelled' },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'hangout link alone',
			{ id: eventId, hangoutLink: video.uri },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'empty conference object',
			{ id: eventId, conferenceData: {} },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'unknown status even with a video URI',
			{
				id: eventId,
				conferenceData: {
					createRequest: { status: { statusCode: 'unknown' } },
					entryPoints: [video]
				}
			},
			{ ok: true, status: 'ambiguous' }
		],
		[
			'success without a URI',
			{
				id: eventId,
				conferenceData: { createRequest: { status: { statusCode: 'success' } } }
			},
			{ ok: true, status: 'ambiguous' }
		],
		[
			'request metadata alone',
			{ id: eventId, conferenceData: { createRequest: { requestId: 'echoed-id' } } },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'non-HTTP video URI',
			{ id: eventId, conferenceData: { entryPoints: [{ ...video, uri: 'javascript:alert(1)' }] } },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'malformed URI',
			{ id: eventId, conferenceData: { entryPoints: [{ ...video, uri: 'not a URL' }] } },
			{ ok: true, status: 'ambiguous' }
		],
		[
			'embedded newline in a URI',
			{
				id: eventId,
				conferenceData: { entryPoints: [{ ...video, uri: 'https://meet.google.com/ab\nc' }] }
			},
			{ ok: true, status: 'ambiguous' }
		],
		[
			'embedded tab in a URI',
			{
				id: eventId,
				conferenceData: { entryPoints: [{ ...video, uri: 'https://meet.google.com/ab\tc' }] }
			},
			{ ok: true, status: 'ambiguous' }
		],
		[
			'embedded control character in a URI',
			{
				id: eventId,
				conferenceData: { entryPoints: [{ ...video, uri: 'https://meet.google.com/ab\u0000c' }] }
			},
			{ ok: true, status: 'ambiguous' }
		],
		[
			'more than one video entry point',
			{
				id: eventId,
				conferenceData: { entryPoints: [video, { ...video, uri: 'https://other.test' }] }
			},
			{ ok: true, status: 'ambiguous' }
		]
	])('decodes %s conservatively', async (_name, response, expected) => {
		const event = fakeEvent(response);
		const adapter = new GoogleMeetAdapter(event);

		const state = await adapter.read(null);

		expect(state).toEqual(expected);
		expect(event.read).toHaveBeenCalledTimes(1);
		expect(event.patch).not.toHaveBeenCalled();
	});
});

describe('GoogleMeetAdapter.request', () => {
	test.each([
		[pending, { ok: true, status: 'pending' }],
		[ready, { ok: true, status: 'ready', url: video.uri }],
		[
			{
				id: eventId,
				conferenceData: {
					createRequest: { status: { statusCode: 'success' } },
					entryPoints: [{ ...video, uri: 'http://video.example.com/room' }]
				}
			},
			{ ok: true, status: 'ready', url: 'http://video.example.com/room' }
		]
	])('returns the immediate observation without polling: %j', async (response, expected) => {
		const event = fakeEvent(response);
		const adapter = new GoogleMeetAdapter(event);

		const result = await adapter.request({ name: 'Booking', requestId: 'checkpointed-request-id' });

		expect(result).toEqual(expected);
		expect(event.read).not.toHaveBeenCalled();
		expect(event.patch).toHaveBeenCalledTimes(1);
		expect(event.patch).toHaveBeenCalledWith(
			{
				conferenceData: {
					createRequest: {
						requestId: 'checkpointed-request-id',
						conferenceSolutionKey: { type: 'hangoutsMeet' }
					}
				}
			},
			{ conferenceDataVersion: '1', sendUpdates: 'none' }
		);
	});
});

describe('GoogleMeetAdapter.removeLink', () => {
	test.each([undefined, { id: eventId }, { id: eventId, conferenceData: null }])(
		'detaches the bound conference, including pending without a URL, retaining the event: %j',
		async (response) => {
			const event = fakeEvent(pending);
			event.patch.mockResolvedValue(response);
			const adapter = new GoogleMeetAdapter(event);

			const result = await adapter.removeLink(null);

			expect(result).toEqual({ ok: true });
			expect(event.read).not.toHaveBeenCalled();
			expect(event.patch).toHaveBeenCalledTimes(1);
			expect(event.patch).toHaveBeenCalledWith(
				{ conferenceData: null },
				{ conferenceDataVersion: '1', sendUpdates: 'none' }
			);
		}
	);

	test.each([null, pending, ready, {}, { id: 'another-event' }])(
		'does not claim removal from an unconfirmed response: %j',
		async (response) => {
			const event = fakeEvent(response);
			const adapter = new GoogleMeetAdapter(event);

			const result = await adapter.removeLink(null);

			expect(result).toEqual({ ok: false, reason: 'Google Meet conference removal not confirmed' });
			expect(event.patch).toHaveBeenCalledTimes(1);
			expect(event.read).not.toHaveBeenCalled();
		}
	);
});

test('read, request and detach operate only on the booked event, retaining its ordinary fields', async () => {
	let stored: Record<string, unknown> = {
		id: eventId,
		summary: 'Booking',
		description: 'Guest notes'
	};
	const event = {
		id: eventId,
		read: vi.fn<GoogleEventPort['read']>(async () => structuredClone(stored)),
		patch: vi.fn<GoogleEventPort['patch']>(async (fields) => {
			stored = { ...stored, ...fields };
			if (fields.conferenceData !== null) stored.conferenceData = pending.conferenceData;
			return structuredClone(stored);
		})
	};
	const adapter = new GoogleMeetAdapter(event);

	const before = await adapter.read(null);
	const requested = await adapter.request({ name: 'Booking', requestId: 'saved-by-caller' });
	const detached = await adapter.removeLink(null);
	const after = await adapter.read(null);

	expect([before, requested, detached, after]).toEqual([
		{ ok: true, status: 'absent' },
		{ ok: true, status: 'pending' },
		{ ok: true },
		{ ok: true, status: 'absent' }
	]);
	expect(stored).toEqual({
		id: eventId,
		summary: 'Booking',
		description: 'Guest notes',
		conferenceData: null
	});
	expect(event.read).toHaveBeenCalledTimes(2);
	expect(event.patch).toHaveBeenCalledTimes(2);
});

test('I/O failures are not provider observations or absence, and do not leak errors', async () => {
	const event = fakeEvent(null);
	event.read.mockRejectedValue(new Error('private transport details'));
	event.patch.mockRejectedValue(new Error('private transport details'));
	const adapter = new GoogleMeetAdapter(event);

	const read = await adapter.read(null);
	const request = await adapter.request({ name: 'Booking', requestId: 'provided-id' });
	const removal = await adapter.removeLink(null);

	expect(read).toEqual({ ok: false, reason: 'Google Meet event read failed' });
	expect(request).toEqual({ ok: false, reason: 'Google Meet conference request failed' });
	expect(removal).toEqual({ ok: false, reason: 'Google Meet conference removal failed' });
	expect(event.read).toHaveBeenCalledTimes(1);
	expect(event.patch).toHaveBeenCalledTimes(2);
});
