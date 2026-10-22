import { describe, expect, test } from 'vitest';
import { appointmentVideoChatAdded } from './appointment-video-chat-added.js';
import { sampleInput } from '../__fixtures__/appointment.js';
import { prepareAppointmentEmails } from '../dispatch.js';
import { whenForGuest, whenForHost } from '../format.js';

const videoUrl = 'https://meet.example.com/room-123';
const input = {
	...sampleInput,
	appointment: { ...sampleInput.appointment, video_chat: videoUrl, ics_sequence: 2 }
};

describe('appointmentVideoChatAdded', () => {
	test.each([null, 'generate'] as const)(
		'uses neutral observed-event copy for video_chat_request=%s without an edit log',
		(video_chat_request) => {
			const [guest, host] = appointmentVideoChatAdded({
				...input,
				appointment: { ...input.appointment, video_chat_request, action_log: null }
			});

			expect(guest.role).toBe('guest');
			expect(guest.to).toBe('jane@example.com');
			expect(guest.content.subject).toBe('Video link added: 30-min with Acme Scheduling');
			expect(guest.content.paragraphs).toEqual(['A video link was added to your appointment.']);
			expect(host.role).toBe('host');
			expect(host.to).toBe('owner@acme.test');
			expect(host.content.subject).toBe('Video link added: 30-min with Jane Doe');
			expect(host.content.paragraphs).toEqual([
				'A video link was added to the appointment with Jane Doe <jane@example.com>.'
			]);
			for (const message of [guest, host]) {
				expect(message.content.heading).toBe('Video link added to appointment');
				expect(JSON.stringify(message.content)).not.toMatch(/You (added|updated|edited)|manually/);
			}
			expect(host.ics).toBeUndefined();
		}
	);

	test.each(['https://meet.google.com/abc-defg-hij', 'https://cloud.example.com/call/room-123'])(
		'includes the saved URI verbatim in both detail tables: %s',
		(video_chat) => {
			const emailInput = {
				...input,
				appointment: { ...input.appointment, video_chat, note: 'Bring a laptop.' }
			};
			const [guest, host] = appointmentVideoChatAdded(emailInput);
			for (const message of [guest, host]) {
				expect(message.content.rows).toContainEqual({ label: 'Video link', value: video_chat });
				expect(message.content.rows).toContainEqual({ label: 'Note', value: 'Bring a laptop.' });
				expect(message.content.rows).toContainEqual({ label: 'Where', value: 'Zoom' });
			}
			expect(guest.content.rows).toContainEqual({ label: 'When', value: whenForGuest(emailInput) });
			expect(host.content.rows).toContainEqual({ label: 'When', value: whenForHost(emailInput) });
			expect(host.content.rows).toContainEqual({
				label: 'Anything else?',
				value: 'Looking forward to it'
			});
			expect(guest.content.actions).toEqual([
				{ href: input.links.booked, label: 'View this appointment' }
			]);
		}
	);

	test('attaches an updated REQUEST using the existing chain UID and saved sequence', () => {
		const [guest] = appointmentVideoChatAdded({
			...input,
			appointment: { ...input.appointment, id: 'rescheduled-row', origin_id: 'original-row' }
		});
		const ics = guest.ics?.content.replace(/\r\n[ \t]/g, '');
		expect(ics).toContain('METHOD:REQUEST');
		expect(ics).toContain('UID:original-row');
		expect(ics).toContain('SEQUENCE:2');
		expect(ics).toContain(`CONFERENCE;VALUE=URI:${videoUrl}`);
		expect(guest.ics?.filename).toBe('invite.ics');
	});

	test('pending notifies only the host with the URI, without any ICS', () => {
		const messages = appointmentVideoChatAdded({
			...input,
			appointment: { ...input.appointment, status: 'pending' }
		});
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('host');
		expect(messages[0].content.rows).toContainEqual({ label: 'Video link', value: videoUrl });
		expect(messages[0].ics).toBeUndefined();
	});

	test('no guest email leaves only the host and omits the address from copy', () => {
		const messages = appointmentVideoChatAdded({
			...input,
			appointment: { ...input.appointment, guest_email: null }
		});
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('host');
		expect(messages[0].content.paragraphs).toEqual([
			'A video link was added to the appointment with Jane Doe.'
		]);
	});

	test('uses the existing brand and logo formatting for both recipients', () => {
		const messages = appointmentVideoChatAdded({
			...input,
			logo: { filename: 'logo.png', content: 'AA==', contentType: 'image/png', cid: 'brand-logo' }
		});
		for (const message of messages) {
			expect(message.content.brand).toMatchObject({
				name: 'Acme Scheduling',
				appUrl: 'https://when.example.com',
				primaryColor: '#2563eb',
				logoUrl: 'cid:brand-logo'
			});
		}
	});

	test.each(['confirmed', 'pending'] as const)(
		'dispatch prepares the new kind with recipient roles and rendered URI for %s',
		async (status) => {
			const prepared = await prepareAppointmentEmails(
				{
					kind: 'video-chat-added',
					appointment: { ...input.appointment, status }
				},
				input.cfg
			);
			expect(prepared.map(({ role }) => role)).toEqual(
				status === 'confirmed' ? ['guest', 'host'] : ['host']
			);
			for (const { envelope } of prepared) {
				expect(envelope.subject).toContain('Video link added:');
				expect(envelope.text).toContain(videoUrl);
				expect(envelope.html).toContain(videoUrl);
				expect(envelope.text).toContain('Acme Scheduling');
			}
			if (status === 'confirmed') {
				expect(prepared[0].envelope.attachments?.[0].content).toContain('METHOD:REQUEST');
			} else {
				expect(prepared[0].envelope.attachments).toBeUndefined();
			}
		}
	);
});
