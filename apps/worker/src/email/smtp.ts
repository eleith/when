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
 * Build a Mailer from the worker config. The transporter is created lazily on
 * the first send and reused; the dependency is explicit (no module-level global,
 * no reaching into the worker context).
 */
export function createMailer(config: WhenConfiguration, logger: Logger): Mailer {
	let transporter: nodemailer.Transporter | null = null;

	const getTransporter = (): nodemailer.Transporter => {
		if (transporter) return transporter;
		if (!config.smtp) throw new Error('SMTP is not configured');
		transporter = nodemailer.createTransport({
			host: config.smtp.host,
			port: config.smtp.port,
			secure: isSecurePort(config.smtp.port),
			auth: { user: config.smtp.user, pass: config.smtp.pass }
		});
		return transporter;
	};

	return {
		async send(envelope: Envelope): Promise<SendResult> {
			try {
				await getTransporter().sendMail({
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
