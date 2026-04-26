import nodemailer from 'nodemailer';
import { logger } from './logger';
import { getConfig } from './state';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
	if (transporter) return transporter;
	const cfg = getConfig();
	if (!cfg.smtp) throw new Error('SMTP is not configured');
	transporter = nodemailer.createTransport({
		host: cfg.smtp.host,
		port: cfg.smtp.port,
		secure: cfg.smtp.port === 465,
		auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }
	});
	return transporter;
}

export interface EmailAttachment {
	filename: string;
	content: string;
	contentType?: string;
}

export async function sendEmail(opts: {
	to: string;
	subject: string;
	text: string;
	html?: string;
	attachments?: EmailAttachment[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
	try {
		const transport = getTransporter();
		const cfg = getConfig();
		await transport.sendMail({
			from: cfg.user.email,
			to: opts.to,
			subject: opts.subject,
			text: opts.text,
			html: opts.html,
			attachments: opts.attachments
		});
		logger.info({ to: opts.to, subject: opts.subject }, 'email sent');
		return { ok: true };
	} catch (err) {
		logger.error({ err, to: opts.to, subject: opts.subject }, 'SMTP send failed');
		return { ok: false, reason: String(err) };
	}
}
