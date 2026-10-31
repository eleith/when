import nodemailer from 'nodemailer';
import { senderEmail, type WhenConfiguration } from '@when/config';
import type { Logger } from '../services/logger.js';
import type { Envelope } from './recipients.js';

export type SmtpFailureCode = 'auth' | 'timeout' | 'connection' | 'rejected' | 'unknown';
export type SendResult = { ok: true } | { ok: false; reason: string; code: SmtpFailureCode };

/** Sends a rendered envelope over SMTP. Built once at boot via `createMailer`. */
export interface Mailer {
	send(envelope: Envelope): Promise<SendResult>;
}

function smtpFailureCode(error: unknown, responseCode: number | undefined): SmtpFailureCode {
	let providerCode: unknown;
	if (error && typeof error === 'object' && 'code' in error) {
		providerCode = error.code;
	}
	if (
		providerCode === 'EAUTH' ||
		responseCode === 530 ||
		responseCode === 534 ||
		responseCode === 535
	)
		return 'auth';
	if (providerCode === 'ETIMEDOUT') return 'timeout';
	if (
		typeof providerCode === 'string' &&
		['ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(
			providerCode
		)
	)
		return 'connection';
	if (responseCode !== undefined) return 'rejected';
	return 'unknown';
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
		requireTLS: !isSecurePort(config.smtp.port),
		auth: { user: config.smtp.username, pass: config.smtp.password }
	});

	const from = `${config.user.name} <${senderEmail(config)}>`;

	return {
		async send(envelope: Envelope): Promise<SendResult> {
			try {
				await transporter.sendMail({
					from,
					to: envelope.to,
					subject: envelope.subject,
					text: envelope.text,
					html: envelope.html,
					attachments: envelope.attachments
				});
				logger.info('email sent');
				return { ok: true };
			} catch (err) {
				// Provider text can contain guest data; log only a validated SMTP failure code.
				let responseCode: number | undefined;
				if (err && typeof err === 'object' && 'responseCode' in err) {
					const code = err.responseCode;
					if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 599) {
						responseCode = code;
					}
				}
				const code = smtpFailureCode(err, responseCode);
				logger.error({ code, responseCode }, 'SMTP send failed');
				return { ok: false, reason: String(err), code };
			}
		}
	};
}
