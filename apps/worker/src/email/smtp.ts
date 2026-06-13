import nodemailer from 'nodemailer';
import type { WhenConfiguration } from '@when/config';
import type { Logger } from '../services/logger.js';
import type { Envelope } from './recipients.js';

export type SendResult = { ok: true } | { ok: false; reason: string };

/** Sends a rendered envelope over SMTP. Built once at boot via `createMailer`. */
export interface Mailer {
	send(envelope: Envelope): Promise<SendResult>;
}

export function isSecurePort(port: number): boolean {
	return port === 465;
}

/**
 * Build a Mailer from the worker config. SMTP is required by config, so the
 * transporter is created up front; the dependency is explicit (no module-level
 * global, no reaching into the worker context).
 */
export function createMailer(config: WhenConfiguration, logger: Logger): Mailer {
	const transporter = nodemailer.createTransport({
		host: config.smtp.host,
		port: config.smtp.port,
		secure: isSecurePort(config.smtp.port),
		auth: { user: config.smtp.user, pass: config.smtp.pass }
	});

	return {
		async send(envelope: Envelope): Promise<SendResult> {
			try {
				await transporter.sendMail({
					from: config.user.email,
					to: envelope.to,
					subject: envelope.subject,
					text: envelope.text,
					html: envelope.html,
					attachments: envelope.attachments
				});
				logger.info('email sent', { to: envelope.to, subject: envelope.subject });
				return { ok: true };
			} catch (err) {
				logger.error('SMTP send failed', {
					error: String(err),
					to: envelope.to,
					subject: envelope.subject
				});
				return { ok: false, reason: String(err) };
			}
		}
	};
}
