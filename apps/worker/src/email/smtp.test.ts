import { describe, expect, test } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createMailer, isSecurePort } from './smtp.js';
import { createLogger } from '../services/logger.js';

describe('smtp', () => {
	test('isSecurePort is true only for 465', () => {
		expect(isSecurePort(465)).toBe(true);
		expect(isSecurePort(587)).toBe(false);
		expect(isSecurePort(25)).toBe(false);
	});

	test('send returns ok:false when SMTP is not configured', async () => {
		const mailer = createMailer(
			{ user: { email: 'owner@acme.test' } } as unknown as WhenConfiguration,
			createLogger()
		);
		const result = await mailer.send({ to: 'jane@example.com', subject: 's', text: 't' });
		expect(result.ok).toBe(false);
	});
});
