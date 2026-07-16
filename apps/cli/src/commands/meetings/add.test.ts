import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { text, select, multiselect, note } from '@clack/prompts';
import { ConfigEditor, MeetingSchema } from '@when/config';
import { meetingsAddCommand, MEETING_HANDLED_FIELDS, MEETING_SKIPPED_FIELDS } from './add.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	select: vi.fn(),
	multiselect: vi.fn(),
	note: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false),
	spinner: vi.fn().mockReturnValue({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })
}));

const CONFIG_WITH_DEPS = `calendars:
  - name: work
    type: caldav
    service: work-service
    path: calendars/user/work/
schedules:
  - name: standard
    weekly: {}
`;

describe('meetings add command', () => {
	const tempConfigPath = join(process.cwd(), 'temp-meetings-config.yaml');

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(note).mockReset();
	});

	afterEach(() => {
		try {
			unlinkSync(tempConfigPath);
		} catch {
			/* ignore */
		}
	});

	const ctxFor = (config: string) =>
		({
			values: { config },
			positionals: [],
			commandPath: []
		}) as unknown as Parameters<NonNullable<typeof meetingsAddCommand.run>>[0];

	test('handled and skipped fields together cover MeetingSchema exactly (drift guard)', () => {
		const covered = [...MEETING_HANDLED_FIELDS, ...MEETING_SKIPPED_FIELDS];
		expect(covered.length).toBe(new Set(covered).size); // no overlap
		expect([...covered].sort()).toEqual(Object.keys(MeetingSchema.properties).sort());
	});

	test('writes a meeting from the prompted answers', async () => {
		writeFileSync(tempConfigPath, CONFIG_WITH_DEPS);

		vi.mocked(text)
			.mockResolvedValueOnce('30-minute chat') // name
			.mockResolvedValueOnce('45') // duration
			.mockResolvedValueOnce('A quick chat') // description
			.mockResolvedValueOnce('chat') // slug
			.mockResolvedValueOnce('Room 101') // location
			.mockResolvedValueOnce('See you soon') // note
			.mockResolvedValueOnce('120') // notice
			.mockResolvedValueOnce('60') // window
			.mockResolvedValueOnce('0') // padding before
			.mockResolvedValueOnce('0') // padding after
			.mockResolvedValueOnce(''); // daily limit -> unlimited
		vi.mocked(select)
			.mockResolvedValueOnce('instant') // booking_approval
			.mockResolvedValueOnce('public') // visibility
			.mockResolvedValueOnce('location') // meet choice
			.mockResolvedValueOnce('standard') // schedule
			.mockResolvedValueOnce('work'); // booking_calendar
		vi.mocked(multiselect).mockResolvedValueOnce(['work']); // busy_calendars

		await meetingsAddCommand.run!(ctxFor(tempConfigPath));

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('meetings.0')).toEqual({
			name: '30-minute chat',
			slug: 'chat',
			duration_minutes: 45,
			booking_approval: 'instant',
			visibility: 'public',
			schedule: 'standard',
			booking_calendar: 'work',
			description: 'A quick chat',
			busy_calendars: ['work'],
			location: 'Room 101',
			note: 'See you soon',
			notice_minutes: 120,
			booking_window_days: 60,
			padding_before_minutes: 0,
			padding_after_minutes: 0,
			daily_booking_limit: null
		});
	});

	test('bails when there are no calendars to pick from', async () => {
		writeFileSync(tempConfigPath, 'schedules:\n  - name: standard\n    weekly: {}\n');

		await meetingsAddCommand.run!(ctxFor(tempConfigPath));

		expect(vi.mocked(note).mock.calls[0]?.[1]).toContain('calendars');
		expect(new ConfigEditor(tempConfigPath).get('meetings')).toBeUndefined();
	});

	test('bails when there are no schedules to pick from', async () => {
		writeFileSync(
			tempConfigPath,
			'calendars:\n  - name: work\n    type: caldav\n    service: s\n    path: c/\n'
		);

		await meetingsAddCommand.run!(ctxFor(tempConfigPath));

		expect(vi.mocked(note).mock.calls[0]?.[1]).toContain('schedules');
		expect(new ConfigEditor(tempConfigPath).get('meetings')).toBeUndefined();
	});
});
