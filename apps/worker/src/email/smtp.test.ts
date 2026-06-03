import { describe, expect, test } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { openDb } from '@when/db';
import { isSecurePort, sendEmail } from './smtp.js';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';

describe('smtp', () => {
	test('isSecurePort is true only for 465', () => {
		expect(isSecurePort(465)).toBe(true);
		expect(isSecurePort(587)).toBe(false);
		expect(isSecurePort(25)).toBe(false);
	});

	test('sendEmail returns ok:false when SMTP is not configured', async () => {
		setWorkerContext({
			config: { user: { email: 'owner@acme.test' } } as unknown as WhenConfiguration,
			logger: createLogger(),
			db: openDb(':memory:')
		});
		const result = await sendEmail({ to: 'jane@example.com', subject: 's', text: 't' });
		expect(result.ok).toBe(false);
	});
});
