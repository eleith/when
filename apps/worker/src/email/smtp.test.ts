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

	test('createMailer builds a mailer from the smtp config', () => {
		const mailer = createMailer(
			{
				user: { email: 'owner@acme.test' },
				smtp: { host: 'smtp.test', port: 587, user: 'u', pass: 'p' }
			} as unknown as WhenConfiguration,
			createLogger()
		);
		expect(typeof mailer.send).toBe('function');
	});
});
