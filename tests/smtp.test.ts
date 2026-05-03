import { expect, test } from 'bun:test';
import { loadEncryptionKey } from '../src/lib/server/crypto';
import { openDb } from '../src/lib/server/db';
import { sendEmail } from '../src/lib/server/smtp';
import { setState } from '../src/lib/server/state';
import { validConfig } from './fixtures/valid-config';

test('sendEmail returns ok:false when smtp is not configured', async () => {
	const db = openDb(':memory:');
	try {
		const encryptionKey = await loadEncryptionKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
		setState({ config: { ...validConfig, smtp: undefined }, db, encryptionKey });
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
