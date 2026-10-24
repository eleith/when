import { describe, expect, test } from 'vitest';
import { appointmentEditedByHost } from './appointment-edited-by-host.js';
import { sampleInput } from '../__fixtures__/appointment.js';
import { fmtWhen } from '../format.js';

describe('appointmentEditedByHost', () => {
	test.each(['confirmed', 'pending'] as const)(
		'duration edited from 90 to 120 minutes on a %s appointment keeps the existing recipient policy',
		(status) => {
			const previousAppointment = {
				...sampleInput.appointment,
				status,
				end_time: '2026-01-05T16:30:00Z',
				ics_sequence: 3,
				note: 'Bring a laptop.',
				video_chat: 'https://meet.example.com/room-123'
			};
			const input = {
				...sampleInput,
				appointment: {
					...previousAppointment,
					end_time: '2026-01-05T17:00:00Z',
					ics_sequence: 4,
					action_log: JSON.stringify([
						{
							action: 'edit',
							actor: 'host',
							at: '2026-01-02T10:00:00Z',
							payload: {
								metadata: {
									changes: ['duration_updated'],
									previous_duration: 90,
									duration: 120
								}
							}
						}
					])
				}
			};

			const messages = appointmentEditedByHost(input);
			expect(messages.map((message) => message.role)).toEqual(
				status === 'confirmed' ? ['guest', 'host'] : ['host']
			);

			const host = messages[messages.length - 1];
			expect(host.to).toBe('owner@acme.test');
			expect(host.content.subject).toBe('Updated details: 30-min with Jane Doe');
			expect(host.content.paragraphs).toEqual([
				'You updated the details for the appointment with Jane Doe <jane@example.com>.',
				'You updated the duration of the appointment.'
			]);
			expect(host.content.rows).toContainEqual({
				label: 'When',
				value: fmtWhen(
					previousAppointment.start_time,
					'2026-01-05T17:00:00Z',
					input.cfg.user.timezone
				)
			});
			expect(host.content.rows).not.toContainEqual({
				label: 'When',
				value: fmtWhen(
					previousAppointment.start_time,
					previousAppointment.end_time,
					input.cfg.user.timezone
				)
			});
			expect(host.content.rows).toContainEqual({ label: 'Note', value: previousAppointment.note });
			expect(host.content.rows).toContainEqual({
				label: 'Video link',
				value: previousAppointment.video_chat
			});
			expect(host.ics).toBeUndefined();

			if (status === 'confirmed') {
				const [guest] = messages;
				expect(guest.to).toBe('jane@example.com');
				expect(guest.content.subject).toBe('Updated details: 30-min with Acme Scheduling');
				expect(guest.content.heading).toBe('Appointment details updated');
				expect(guest.content.paragraphs).toEqual(['The duration of your appointment was updated.']);
				expect(guest.content.rows).toContainEqual({
					label: 'When',
					value: fmtWhen(
						previousAppointment.start_time,
						'2026-01-05T17:00:00Z',
						'America/Los_Angeles'
					)
				});
				const ics = guest.ics?.content;
				expect(ics).toContain('METHOD:REQUEST');
				expect(ics).toContain('UID:appt-1');
				expect(ics).toMatch(/^DTSTART(?:;[^:\r\n]+)?:20260105T150000Z\r?$/m);
				expect(ics).toMatch(/^DTEND(?:;[^:\r\n]+)?:20260105T170000Z\r?$/m);
				expect(ics).not.toContain('20260105T163000Z');
				expect(ics).toContain('SEQUENCE:4');
			}
		}
	);

	test('note added on a confirmed appointment (notifies both, has guest ics)', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['note_added']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				note: 'Please bring your laptop.',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Note added: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Note added to appointment');
		expect(guest.content.paragraphs).toContain('A note was added to your appointment.');
		expect(guest.content.rows).toContainEqual({
			label: 'Note',
			value: 'Please bring your laptop.'
		});
		expect(guest.ics?.content).toContain('METHOD:REQUEST');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Note added: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Note added to appointment');
		expect(host.content.paragraphs).toContain(
			'You updated the details for the appointment with Jane Doe <jane@example.com>.'
		);
		expect(host.content.rows).toContainEqual({ label: 'Note', value: 'Please bring your laptop.' });
		expect(host.ics).toBeUndefined();
	});

	test('note updated on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['note_updated']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				note: 'Location changed to Zoom.',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Note updated: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Note updated for appointment');
		expect(guest.content.paragraphs).toContain('The note on your appointment was updated.');
		expect(guest.content.rows).toContainEqual({
			label: 'Note',
			value: 'Location changed to Zoom.'
		});

		expect(host.content.subject).toBe('Note updated: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Note updated for appointment');
	});

	test('note removed on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['note_removed']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				note: null,
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Note removed: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Note removed from appointment');
		expect(guest.content.paragraphs).toContain('The note on your appointment was removed.');
		expect(guest.content.rows.find((r) => r.label === 'Note')).toBeUndefined();

		expect(host.content.subject).toBe('Note removed: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Note removed from appointment');
	});

	test('details edited on a pending appointment (only host is notified, guest gets nothing)', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['note_added']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'pending' as const,
				note: 'Draft note.',
				action_log
			}
		};

		const messages = appointmentEditedByHost(input);
		expect(messages.length).toBe(1); // Only 1 message (host)

		const [host] = messages;
		expect(host.to).toBe('owner@acme.test');
		expect(host.content.rows).toContainEqual({ label: 'Note', value: 'Draft note.' });
	});

	test('location added on a confirmed appointment (notifies both, has guest ics)', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['location_added']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				location: 'Meeting Room C',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Location added: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Location added to appointment');
		expect(guest.content.paragraphs).toContain('A location was added to your appointment.');
		expect(guest.content.rows).toContainEqual({
			label: 'Where',
			value: 'Meeting Room C'
		});
		expect(guest.ics?.content).toContain('METHOD:REQUEST');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Location added: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Location added to appointment');
		expect(host.content.paragraphs).toContain(
			'You updated the details for the appointment with Jane Doe <jane@example.com>.'
		);
		expect(host.content.rows).toContainEqual({ label: 'Where', value: 'Meeting Room C' });
		expect(host.ics).toBeUndefined();
	});

	test('location updated on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['location_updated']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				location: 'Meeting Room D',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Location updated: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Location updated for appointment');
		expect(guest.content.paragraphs).toContain('The location of your appointment was updated.');
		expect(guest.content.rows).toContainEqual({
			label: 'Where',
			value: 'Meeting Room D'
		});

		expect(host.content.subject).toBe('Location updated: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Location updated for appointment');
	});

	test('location removed on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['location_removed']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				location: null,
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Location removed: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Location removed from appointment');
		expect(guest.content.paragraphs).toContain('The location of your appointment was removed.');
		expect(guest.content.rows.find((r) => r.label === 'Where')?.value).toBeNull();

		expect(host.content.subject).toBe('Location removed: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Location removed from appointment');
	});

	test('video_chat link added on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['video_chat_added']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				video_chat: 'https://zoom.us/j/12345',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Video link added: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Video link added to appointment');
		expect(guest.content.paragraphs).toContain('A video link was added to your appointment.');
		expect(guest.content.rows).toContainEqual({
			label: 'Video link',
			value: 'https://zoom.us/j/12345'
		});

		expect(host.content.subject).toBe('Video link added: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Video link added to appointment');
		expect(host.content.rows).toContainEqual({
			label: 'Video link',
			value: 'https://zoom.us/j/12345'
		});
	});

	test('video_chat link updated on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['video_chat_updated']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				video_chat: 'https://zoom.us/j/67890',
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Video link updated: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Video link updated for appointment');
		expect(guest.content.paragraphs).toContain('The video link of your appointment was updated.');
		expect(guest.content.rows).toContainEqual({
			label: 'Video link',
			value: 'https://zoom.us/j/67890'
		});

		expect(host.content.subject).toBe('Video link updated: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Video link updated for appointment');
	});

	test('video_chat link removed on a confirmed appointment', () => {
		const action_log = JSON.stringify([
			{
				action: 'edit',
				actor: 'host',
				at: '2026-01-02T10:00:00Z',
				payload: {
					metadata: {
						changes: ['video_chat_removed']
					}
				}
			}
		]);

		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				status: 'confirmed' as const,
				video_chat: null,
				action_log
			}
		};

		const [guest, host] = appointmentEditedByHost(input);

		expect(guest.content.subject).toBe('Video link removed: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Video link removed from appointment');
		expect(guest.content.paragraphs).toContain('The video link of your appointment was removed.');
		expect(guest.content.rows.find((r) => r.label === 'Video link')?.value).toBeUndefined();

		expect(host.content.subject).toBe('Video link removed: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Video link removed from appointment');
	});
});
