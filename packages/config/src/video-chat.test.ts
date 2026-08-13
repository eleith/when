import { describe, expect, test } from 'vitest';
import type { GuestAnswer } from './form-fields.js';
import type { Meeting, WhenConfiguration } from './schema.js';
import { shouldAttachVideoChat } from './video-chat.js';

const mockConfig = {
	providers: {
		'google-prov': { type: 'google' },
		'nc-prov': { type: 'nextcloud' },
		'caldav-prov': { type: 'caldav' }
	}
} as unknown as WhenConfiguration;

const baseMeeting: Meeting = {
	title: 'Chat',
	duration_minutes: 30,
	additional_duration_minutes: [],
	visibility: 'public',
	require_approval: true,
	additional_busy_calendars: [],
	booking_calendar: 'main-cal',
	schedule: 'standard',
	show_slots: false,
	start_times_every_minutes: 30,
	notice_minutes: 120,
	booking_window_days: 60,
	padding_before_minutes: 0,
	padding_after_minutes: 0,
	daily_booking_limit: null
};

describe('shouldAttachVideoChat', () => {
	test('returns false when video_chat is not configured', () => {
		expect(shouldAttachVideoChat(baseMeeting, mockConfig)).toBe(false);
	});

	test('returns false when provider is missing from config', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'unknown-prov' }
		};
		expect(shouldAttachVideoChat(meeting, mockConfig)).toBe(false);
	});

	test('returns true when attach.auto is true or omitted', () => {
		const meetingGoogle: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'google-prov', attach: { auto: true } }
		};
		expect(shouldAttachVideoChat(meetingGoogle, mockConfig)).toBe(true);

		const meetingNc: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'nc-prov' }
		};
		expect(shouldAttachVideoChat(meetingNc, mockConfig)).toBe(true);
	});

	test('returns false when attach.auto is false', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'nc-prov', attach: { auto: false } }
		};
		expect(shouldAttachVideoChat(meeting, mockConfig)).toBe(false);
	});

	test('evaluates attach.when conditions against guest answers', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: {
				provider: 'nc-prov',
				attach: {
					when: [{ field: 'format', equals: 'online' }]
				}
			}
		};

		const inPersonAnswers: GuestAnswer[] = [
			{ name: 'format', label: 'Format', type: 'choice', value: 'in-person' }
		];
		expect(shouldAttachVideoChat(meeting, mockConfig, inPersonAnswers)).toBe(false);

		const onlineAnswers: GuestAnswer[] = [
			{ name: 'format', label: 'Format', type: 'choice', value: 'online' }
		];
		expect(shouldAttachVideoChat(meeting, mockConfig, onlineAnswers)).toBe(true);
	});

	test('supports array of accepted values in attach.when', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: {
				provider: 'google-prov',
				attach: {
					when: [{ field: 'format', equals: ['online', 'hybrid'] }]
				}
			}
		};

		expect(
			shouldAttachVideoChat(meeting, mockConfig, [
				{ name: 'format', label: 'Format', type: 'choice', value: 'hybrid' }
			])
		).toBe(true);
	});
});
