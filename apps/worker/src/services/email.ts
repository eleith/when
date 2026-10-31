import type { WhenConfiguration } from '@when/config';
import { createMailer as createSmtpMailer } from '../email/smtp.js';
import { observeMailer, observeAppointmentEmail } from '../metrics/email.js';
import type { Logger } from './logger.js';

/** SMTP operation API shared by appointment and test-email workflows. */
export function createMailer(config: WhenConfiguration, logger: Logger) {
	return observeMailer(createSmtpMailer(config, logger));
}

export const sendAppointmentEmail = observeAppointmentEmail;
