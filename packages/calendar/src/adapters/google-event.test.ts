import { afterEach, describe, expect, test, vi } from 'vitest';
import { getGoogleEvent, patchGoogleEvent, type GoogleConfig } from '../index.js';

const cfg: GoogleConfig = {
	client_id: 'client',
	client_secret: 'secret',
	refresh_token: 'event-refresh',
	google_calendar_id: 'work/calendar@example.com'
};
const eventId = 'event/id?';
const eventUrl =
	'https://www.googleapis.com/calendar/v3/calendars/work%2Fcalendar%40example.com/events/event%2Fid%3F';

function mockGoogle(response: unknown) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		if (String(input) === 'https://oauth2.googleapis.com/token' && init?.method === 'POST') {
			return new Response(JSON.stringify({ access_token: 'event-token', expires_in: 0 }));
		}
		requests.push({ url: String(input), init: init ?? {} });
		if (response instanceof Error) throw response;
		if (response instanceof Response) return response;
		return new Response(JSON.stringify(response));
	});
	return { requests, fetchSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('getGoogleEvent', () => {
	test('GETs the encoded resource with shared auth, returning unknown JSON without interpretation', async () => {
		const body = { id: eventId, summary: 'Appointment', arbitrary: [1, null, 'data'] };
		const { requests, fetchSpy } = mockGoogle(body);

		const result = await getGoogleEvent(cfg, eventId);

		expect(result).toEqual(body);
		expect(requests).toEqual([
			{
				url: eventUrl,
				init: { signal: undefined, headers: { Authorization: 'Bearer event-token' } }
			}
		]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe('patchGoogleEvent', () => {
	test('PATCHes only supplied fields/query with encoded values, without reads or polling', async () => {
		const body = { id: eventId, summary: 'Changed' };
		const { requests, fetchSpy } = mockGoogle(body);
		const fields = { summary: 'Changed', description: null };

		const result = await patchGoogleEvent(cfg, eventId, fields, { custom: 'a/b & c' });

		expect(result).toEqual(body);
		expect(requests).toEqual([
			{
				url: `${eventUrl}?custom=a%2Fb+%26+c`,
				init: {
					method: 'PATCH',
					signal: undefined,
					headers: { Authorization: 'Bearer event-token', 'Content-Type': 'application/json' },
					body: JSON.stringify(fields)
				}
			}
		]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	test('PATCH 204 returns undefined without reading JSON', async () => {
		const response = new Response(null, { status: 204 });
		const read = vi.spyOn(response, 'text');
		const { requests } = mockGoogle(response);

		const result = await patchGoogleEvent(cfg, eventId, { description: null }, {});

		expect(result).toBeUndefined();
		expect(read).not.toHaveBeenCalled();
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(eventUrl);
	});

	test('PATCH 200 JSON null stays distinct from a no-content acknowledgment', async () => {
		mockGoogle(new Response('null', { status: 200 }));

		const result = await patchGoogleEvent(cfg, eventId, { description: null }, {});

		expect(result).toBeNull();
	});
});

test.each(['GET', 'PATCH'] as const)(
	'%s rejects bounded transport failures without retries',
	async (method) => {
		const operation = () =>
			method === 'GET'
				? getGoogleEvent(cfg, eventId)
				: patchGoogleEvent(cfg, eventId, { summary: 'Changed' }, {});
		const cases = [
			{
				response: new Response('private provider payload', {
					status: 503,
					statusText: 'private status'
				}),
				reason: 'Google event HTTP error: 503'
			},
			{
				response: new Error('private network details'),
				reason: `Google event ${method} request failed`
			},
			{
				response: new Response('private invalid JSON'),
				reason: 'Google event response is not valid JSON'
			}
		];
		for (const { response, reason } of cases) {
			const { requests } = mockGoogle(response);
			const result = operation();

			await expect(result).rejects.toThrow(new RegExp(`^${reason}$`));
			expect(requests).toHaveLength(1);
		}

		const response = new Response();
		vi.spyOn(response, 'text').mockRejectedValue(new TypeError('private body read details'));
		const { requests } = mockGoogle(response);
		const result = operation();

		await expect(result).rejects.toThrow(/^Google event response read failed$/);
		expect(requests).toHaveLength(1);
	}
);

test('authentication failure is bounded and does not request the event', async () => {
	const fetchSpy = vi
		.spyOn(globalThis, 'fetch')
		.mockRejectedValue(new Error('private auth details'));

	const result = getGoogleEvent(cfg, eventId);

	await expect(result).rejects.toThrow(/^Google event GET request failed$/);
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each(['GET', 'PATCH'] as const)(
	'%s forwards the same optional caller signal to OAuth and the event without creating deadlines',
	async (method) => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const controller = new AbortController();
		for (const signal of [undefined, controller.signal]) {
			const { fetchSpy } = mockGoogle({ id: eventId });
			const operation =
				method === 'GET'
					? getGoogleEvent(cfg, eventId, signal)
					: patchGoogleEvent(cfg, eventId, { summary: 'Changed' }, {}, signal);
			const result = await operation;

			expect(result).toEqual({ id: eventId });
			expect(fetchSpy).toHaveBeenCalledTimes(2);
			for (const [, init] of fetchSpy.mock.calls) {
				expect(init?.signal).toBe(signal);
			}
			fetchSpy.mockRestore();
		}
		expect(timeout).not.toHaveBeenCalled();
	}
);

test.each(['GET', 'PATCH'] as const)(
	'%s converts caller cancellation during OAuth or event I/O to the existing transport error',
	async (method) => {
		for (const stage of ['token', 'event']) {
			const controller = new AbortController();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
				expect(init?.signal).toBe(controller.signal);
				if (stage === 'event' && String(input) === 'https://oauth2.googleapis.com/token') {
					return new Response(JSON.stringify({ access_token: 'event-token', expires_in: 0 }));
				}
				const response = new Promise<Response>((_resolve, reject) => {
					controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
						once: true
					});
				});
				controller.abort();
				return response;
			});
			const result =
				method === 'GET'
					? getGoogleEvent(cfg, eventId, controller.signal)
					: patchGoogleEvent(cfg, eventId, {}, {}, controller.signal);

			await expect(result).rejects.toThrow(`Google event ${method} request failed`);
			expect(fetchSpy).toHaveBeenCalledTimes(stage === 'token' ? 1 : 2);
			fetchSpy.mockRestore();
		}
	}
);
