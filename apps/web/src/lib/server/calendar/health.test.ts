import { expect, test } from 'vitest';
import type { ServiceStatus } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { evaluateCalendarStatuses } from './health.js';

const START = Temporal.Instant.from('2026-05-01T00:00:00Z');

const config: WhenConfiguration = {
	...validConfig,
	providers: {
		dav: {
			type: 'caldav',
			url: 'https://dav.example.com',
			username: 'user',
			password: 'secret',
			calendars: { work: { href: 'work/', sync: { refresh_every_minutes: 20 } } }
		}
	},
	meetings: {}
};

const refreshed: ServiceStatus = {
	kind: 'calendar',
	name: 'work',
	last_attempt_at: START.toString(),
	last_ok_at: START.toString(),
	failing_since: null,
	error: null,
	via: 'refresh'
};

test.each(['refresh', 'test'])(
	'latest successful calendar %s is healthy within interval + grace',
	(via) => {
		const results = evaluateCalendarStatuses(
			[{ ...refreshed, via }],
			config,
			START.add({ minutes: 50 })
		);

		expect(results).toEqual([{ id: 'work', health: 'good', reason: null, since: null }]);
	}
);

test.each(['refresh', 'test'])(
	'latest successful calendar %s is bad beyond interval + grace',
	(via) => {
		const results = evaluateCalendarStatuses(
			[{ ...refreshed, via }],
			config,
			START.add({ minutes: 50, seconds: 1 })
		);

		expect(results).toEqual([
			{
				id: 'work',
				health: 'bad',
				reason: `No successful refresh since ${START.toString()}.`,
				since: START.toString()
			}
		]);
	}
);

test.each<{ label: string; status: Partial<ServiceStatus> }>([
	{ label: 'successful push', status: { via: 'push' } },
	{ label: 'missing success', status: { last_ok_at: null } },
	{ label: 'missing attempt', status: { last_attempt_at: null } },
	{ label: 'missing observation', status: { via: null } },
	{ label: 'unknown observation', status: { via: 'other' } },
	{ label: 'invalid success', status: { last_ok_at: 'not-a-date' } },
	{ label: 'invalid attempt', status: { last_attempt_at: 'not-a-date' } },
	{
		label: 'matching malformed timestamps',
		status: { last_ok_at: 'not-a-date', last_attempt_at: 'not-a-date' }
	},
	{
		label: 'success older than attempt',
		status: { last_attempt_at: START.add({ minutes: 1 }).toString() }
	},
	{
		label: 'success newer than attempt',
		status: { last_ok_at: START.add({ minutes: 1 }).toString() }
	},
	{ label: 'inconsistent failure state', status: { failing_since: START.toString() } },
	{ label: 'provider authentication test', status: { kind: 'provider', via: 'test' } },
	{ label: 'provider discovery', status: { kind: 'provider', via: 'test' } }
])('$label leaves refresh freshness unknown even long after the attempt', ({ status }) => {
	const results = evaluateCalendarStatuses(
		[{ ...refreshed, ...status }],
		config,
		START.add({ hours: 48 })
	);

	expect(results).toEqual([{ id: 'work', health: 'unknown', reason: null, since: null }]);
});

test('missing status has no health claim', () => {
	const results = evaluateCalendarStatuses([], config, START);

	expect(results).toEqual([]);
});

test.each(['refresh', 'test', 'push'])(
	'explicit %s error preserves the failure without claiming refresh history',
	(via) => {
		const failureAt = START.add({ minutes: 5 }).toString();
		const results = evaluateCalendarStatuses(
			[
				{
					...refreshed,
					via,
					last_attempt_at: failureAt,
					error: 'provider unavailable',
					failing_since: failureAt
				}
			],
			config,
			START.add({ minutes: 10 })
		);

		expect(results).toEqual([
			{ id: 'work', health: 'bad', reason: 'provider unavailable', since: failureAt }
		]);
	}
);

test('failure without any success does not fabricate a never-synced verdict', () => {
	const results = evaluateCalendarStatuses(
		[
			{
				...refreshed,
				last_ok_at: null,
				error: 'connection timeout',
				failing_since: START.toString()
			}
		],
		config,
		START.add({ minutes: 20 })
	);

	expect(results).toEqual([
		{ id: 'work', health: 'bad', reason: 'connection timeout', since: START.toString() }
	]);
});
