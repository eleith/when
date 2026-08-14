import { describe, expect, test } from 'vitest';
import type { GuestAnswer, Meeting, WhenConfiguration } from '@when/config';
import { shouldAttachVideoChat } from './attach.js';

const mockConfig = {
	url: { app: 'https://when.example.com' },
	providers: {
		'google-service': { type: 'google' },
		'nc-service': { type: 'nextcloud', url: 'https://cloud.example.com' }
	},
	meetings: {}
} as unknown as WhenConfiguration;

const baseMeeting: Meeting = {
	title: 'Chat',
	duration_minutes: 30,
	require_approval: false,
	booking_calendar: 'my-cal',
	schedule: 'standard'
};

describe('shouldAttachVideoChat', () => {
	test('returns false when meeting has no video_chat', () => {
		expect(shouldAttachVideoChat(baseMeeting, mockConfig)).toBe(false);
	});

	test('returns false when provider does not exist in config', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'unknown-service' }
		};
		expect(shouldAttachVideoChat(meeting, mockConfig)).toBe(false);
	});

	test('returns true for default normalized config (auto: true)', () => {
		const meetingGoogle: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'google-service', attach: { auto: true } }
		};
		expect(shouldAttachVideoChat(meetingGoogle, mockConfig)).toBe(true);

		const meetingNc: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'nc-service', attach: { auto: true } }
		};
		expect(shouldAttachVideoChat(meetingNc, mockConfig)).toBe(true);
	});

	test('returns false when auto is explicitly false', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: { provider: 'google-service', attach: { auto: false } }
		};
		expect(shouldAttachVideoChat(meeting, mockConfig)).toBe(false);
	});

	test('evaluates when condition rules against guest answers', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: {
				provider: 'google-service',
				attach: {
					auto: true,
					when: [{ field: 'location_choice', equals: 'online' }]
				}
			}
		};

		const inPersonAnswers: GuestAnswer[] = [
			{ id: '1', name: 'location_choice', label: 'Location', type: 'select', value: 'in_person' }
		];
		expect(shouldAttachVideoChat(meeting, mockConfig, inPersonAnswers)).toBe(false);

		const onlineAnswers: GuestAnswer[] = [
			{ id: '1', name: 'location_choice', label: 'Location', type: 'select', value: 'online' }
		];
		expect(shouldAttachVideoChat(meeting, mockConfig, onlineAnswers)).toBe(true);
	});

	test('supports multi-value array in equals', () => {
		const meeting: Meeting = {
			...baseMeeting,
			video_chat: {
				provider: 'google-service',
				attach: {
					auto: true,
					when: [{ field: 'location_choice', equals: ['online', 'video'] }]
				}
			}
		};

		expect(
			shouldAttachVideoChat(meeting, mockConfig, [
				{ id: '1', name: 'location_choice', label: 'Loc', type: 'select', value: 'video' }
			])
		).toBe(true);

		expect(
			shouldAttachVideoChat(meeting, mockConfig, [
				{ id: '1', name: 'location_choice', label: 'Loc', type: 'select', value: 'phone' }
			])
		).toBe(false);
	});
});
