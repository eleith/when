import { describe, expect, test } from 'vitest';
import { appointmentDeclined } from './appointment-declined.js';
import { sampleInput } from '../__fixtures__/appointment.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import { emailTheme } from '../theme.js';

describe('appointmentDeclined', () => {
	test('guest + host messages, no note or ics', () => {
		const result = appointmentDeclined(sampleInput);
		const [guest, host] = result;

		expect(result).toHaveLength(2);
		expect(guest.role).toBe('guest');
		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Declined: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Your appointment request was declined.');
		expect(guest.content.paragraphs).toEqual([]);
		expect(guest.content.actions).toEqual([]);
		expect(guest.ics).toBeUndefined();

		expect(host.role).toBe('host');
		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Declined: 30-min from Jane Doe');
		expect(host.content.paragraphs).toEqual([
			'You declined the request from Jane Doe <jane@example.com>.'
		]);
		expect(host.content.actions).toEqual([]);
		expect(host.ics).toBeUndefined();
	});

	test('includes the multiline decline note as escaped plain text in both copies', () => {
		const note = 'Sorry, <b>not available</b> & busy.\nPlease try next week.';
		const input = {
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				note: 'General appointment note',
				action_log: JSON.stringify([
					{
						action: 'decline',
						actor: 'host',
						at: '2026-01-02T12:00:00Z',
						payload: { note }
					},
					{
						action: 'cancel',
						actor: 'host',
						at: '2026-01-03T12:00:00Z',
						payload: { note: 'Cancellation note' }
					}
				])
			}
		};
		const result = appointmentDeclined(input);
		const [guest, host] = result;

		expect(guest.content.paragraphs).toEqual([`Note: ${note}`]);
		expect(host.content.paragraphs).toEqual([
			'You declined the request from Jane Doe <jane@example.com>.',
			`Note: ${note}`
		]);
		for (const message of result) {
			const html = renderHtmlBody(message.content, emailTheme(input.cfg.user.appearance));
			const text = renderTextBody(message.content);

			expect(html).toContain(
				'Note: Sorry, &lt;b&gt;not available&lt;/b&gt; &amp; busy.\nPlease try next week.'
			);
			expect(html).toContain('<span style="white-space: pre-line">Note: Sorry,');
			expect(html).not.toContain('<b>not available</b>');
			expect(text).toContain(`Note: ${note}`);
			for (const body of [html, text]) {
				expect(body).not.toContain('General appointment note');
				expect(body).not.toContain('Cancellation note');
			}
		}
	});

	test('uses only the latest decline entry', () => {
		const [guest, host] = appointmentDeclined({
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				action_log: JSON.stringify([
					{
						action: 'decline',
						actor: 'host',
						at: '2026-01-02T12:00:00Z',
						payload: { note: 'Earlier decline note' }
					},
					{
						action: 'decline',
						actor: 'host',
						at: '2026-01-03T12:00:00Z',
						payload: { note: 'Latest decline note' }
					}
				])
			}
		});

		expect(guest.content.paragraphs).toEqual(['Note: Latest decline note']);
		expect(host.content.paragraphs).toEqual([
			'You declined the request from Jane Doe <jane@example.com>.',
			'Note: Latest decline note'
		]);
	});

	test.each([
		{ name: 'no action log', actionLog: null },
		{
			name: 'only a cancellation note',
			actionLog: JSON.stringify([
				{
					action: 'cancel',
					actor: 'host',
					at: '2026-01-02T12:00:00Z',
					payload: { note: 'Cancellation note' }
				}
			])
		},
		...[undefined, {}, { note: '' }].map((payload) => ({
			name: `latest decline has no note (${JSON.stringify(payload)})`,
			actionLog: JSON.stringify([
				{
					action: 'decline',
					actor: 'host',
					at: '2026-01-02T12:00:00Z',
					payload: { note: 'Earlier decline note' }
				},
				{ action: 'decline', actor: 'host', at: '2026-01-03T12:00:00Z', payload }
			])
		}))
	])('preserves old paragraphs without falling back when $name', ({ actionLog }) => {
		const [guest, host] = appointmentDeclined({
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				note: 'General appointment note',
				action_log: actionLog
			}
		});

		expect(guest.content.paragraphs).toEqual([]);
		expect(host.content.paragraphs).toEqual([
			'You declined the request from Jane Doe <jane@example.com>.'
		]);
	});

	test('still sends only the host copy when the guest has no email', () => {
		const result = appointmentDeclined({
			...sampleInput,
			appointment: {
				...sampleInput.appointment,
				guest_email: null,
				action_log: JSON.stringify([
					{
						action: 'decline',
						actor: 'host',
						at: '2026-01-02T12:00:00Z',
						payload: { note: 'Please try next week.' }
					}
				])
			}
		});

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe('host');
		expect(result[0].to).toBe('owner@acme.test');
		expect(result[0].content.paragraphs).toEqual([
			'You declined the request from Jane Doe.',
			'Note: Please try next week.'
		]);
		expect(result[0].ics).toBeUndefined();
	});
});
