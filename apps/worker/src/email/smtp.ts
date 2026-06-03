import nodemailer from 'nodemailer';
import { getWorkerContext } from '../services/context.js';
import type { Envelope } from './recipients.js';

let transporter: nodemailer.Transporter | null = null;

export function isSecurePort(port: number): boolean {
	return port === 465;
}

function getTransporter(): nodemailer.Transporter {
	if (transporter) return transporter;
	const { config } = getWorkerContext();
	if (!config.smtp) throw new Error('SMTP is not configured');
	transporter = nodemailer.createTransport({
		host: config.smtp.host,
		port: config.smtp.port,
		secure: isSecurePort(config.smtp.port),
		auth: { user: config.smtp.user, pass: config.smtp.pass }
	});
	return transporter;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/** Send one rendered envelope over SMTP, using the worker context's config. */
export async function sendEmail(envelope: Envelope): Promise<SendResult> {
	const { config, logger } = getWorkerContext();
	try {
		const transport = getTransporter();
		await transport.sendMail({
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
