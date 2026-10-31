import type { AppointmentEmailKind } from '@when/jobs';
import type { Mailer, SendResult } from '../email/smtp.js';
import type { Envelope, RecipientRole } from '../email/recipients.js';
import { emailsTotal, operationFailuresTotal } from './registry.js';

/** Physical SMTP attempts, including test mail; no recipient or message labels. */
export function observeMailer(mailer: Mailer): Mailer {
	return {
		async send(envelope): Promise<SendResult> {
			const result = await mailer.send(envelope);
			if (!result.ok) {
				operationFailuresTotal.inc({ operation: 'smtp_send', code: result.code });
			}
			return result;
		}
	};
}

/** Legacy appointment-only attempt scope, independent of physical failure counting. */
export async function observeAppointmentEmail(
	mailer: Mailer,
	envelope: Envelope,
	role: RecipientRole,
	kind: AppointmentEmailKind
): Promise<SendResult> {
	const result = await mailer.send(envelope);
	const status = result.ok ? 'success' : 'failure';
	emailsTotal.inc({
		recipient_type: role,
		email_kind: kind,
		status
	});
	return result;
}
