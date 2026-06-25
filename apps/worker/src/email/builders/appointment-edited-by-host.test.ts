import { describe, expect, test } from 'vitest';
import { appointmentEditedByHost } from './appointment-edited-by-host.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentEditedByHost', () => {
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
		expect(guest.content.rows).toContainEqual({ label: 'Note', value: 'Please bring your laptop.' });
		expect(guest.ics?.content).toContain('METHOD:REQUEST');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Note added: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Note added to appointment');
		expect(host.content.paragraphs).toContain('You updated the details for the appointment with Jane Doe <jane@example.com>.');
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
		expect(guest.content.rows).toContainEqual({ label: 'Note', value: 'Location changed to Zoom.' });

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
});
