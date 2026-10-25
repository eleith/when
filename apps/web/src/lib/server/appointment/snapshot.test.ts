import { describe, expect, test } from 'vitest';
import { readMeetingSnapshot } from './snapshot';

describe('readMeetingSnapshot', () => {
	test('reads only display details from the partial snapshot written by booking', () => {
		const snapshot = JSON.stringify({
			title: '30-minute chat',
			duration_minutes: 30,
			description: 'A quick introduction.',
			slug: 'chat'
		});
		expect(readMeetingSnapshot(snapshot)).toEqual({
			title: '30-minute chat',
			description: 'A quick introduction.'
		});
	});

	test('accepts a title without a description or scheduling settings', () => {
		expect(readMeetingSnapshot(JSON.stringify({ title: 'Historical meeting' }))).toEqual({
			title: 'Historical meeting',
			description: undefined
		});
	});

	test.each([null, 42, ['text'], { text: 'not a description' }])(
		'ignores non-text description %j',
		(description) => {
			expect(
				readMeetingSnapshot(JSON.stringify({ title: 'Historical meeting', description }))
			).toEqual({
				title: 'Historical meeting',
				description: undefined
			});
		}
	);

	test('does not invent configuration from a full or forged snapshot', () => {
		const snapshot = JSON.stringify({
			title: 'Historical meeting',
			description: 'Saved description',
			additional_duration_minutes: [999],
			booking_calendar: 'missing',
			schedule: 'missing',
			require_approval: false,
			video_chat: { provider: 'fake' }
		});
		expect(readMeetingSnapshot(snapshot)).toEqual({
			title: 'Historical meeting',
			description: 'Saved description'
		});
	});

	test('keeps saved text as data for normal escaped rendering', () => {
		const title = '<b>Historical meeting</b>';
		const description = '<script>not executable markup</script>';
		expect(readMeetingSnapshot(JSON.stringify({ title, description }))).toEqual({
			title,
			description
		});
	});

	test.each([
		null,
		'',
		'{broken',
		'null',
		'true',
		'42',
		'"meeting"',
		'[]',
		'{}',
		'{"title":null}',
		'{"title":42}',
		'{"title":[]}',
		'{"title":""}',
		'{"title":"   "}'
	])('returns no display details for unusable snapshot %j', (snapshot) => {
		expect(readMeetingSnapshot(snapshot)).toBeNull();
	});
});
