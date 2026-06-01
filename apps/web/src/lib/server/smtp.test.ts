import { expect, test } from 'vitest';
import { openDb } from '@when/db';
import { isSecurePort, sendEmail } from './smtp';
import { setState } from '$lib/server/state';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

test('isSecurePort returns true only for port 465', () => {
	expect(isSecurePort(465)).toBe(true);
	expect(isSecurePort(587)).toBe(false);
	expect(isSecurePort(25)).toBe(false);
	expect(isSecurePort(2525)).toBe(false);
});

test('sendEmail returns ok:false when SMTP is not configured', async () => {
	const db = openDb(':memory:');
	try {
		setState({ config: { ...validConfig, smtp: undefined }, db });
		const result = await sendEmail({
			to: 'someone@example.com',
			subject: 'hi',
			text: 'hello'
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('SMTP is not configured');
	} finally {
		await db.destroy();
	}
});
