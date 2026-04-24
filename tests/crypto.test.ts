import { expect, test } from 'bun:test';
import { decrypt, encrypt, loadEncryptionKey } from '../src/lib/server/crypto';

function randomKey(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

test('loadEncryptionKey reads a base64 32-byte key', async () => {
	const key = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	expect(key.type).toBe('secret');
});

test('loadEncryptionKey generates an ephemeral key in dev', async () => {
	const key = await loadEncryptionKey({});
	expect(key.type).toBe('secret');
});

test('loadEncryptionKey refuses to start in production without the var', async () => {
	await expect(loadEncryptionKey({ NODE_ENV: 'production' })).rejects.toThrow(
		/ENCRYPTION_KEY env var is required/
	);
});

test('loadEncryptionKey rejects wrong-length keys', async () => {
	const shortKey = Buffer.from('short').toString('base64');
	await expect(loadEncryptionKey({ ENCRYPTION_KEY: shortKey })).rejects.toThrow(/32 bytes/);
});

test('encrypt/decrypt round-trip', async () => {
	const key = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	const blob = await encrypt('hello world', key);
	expect(blob).not.toContain('hello');
	const decoded = await decrypt(blob, key);
	expect(decoded).toBe('hello world');
});

test('each encrypt call uses a fresh IV (ciphertext differs)', async () => {
	const key = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	const a = await encrypt('same plaintext', key);
	const b = await encrypt('same plaintext', key);
	expect(a).not.toBe(b);
});

test('decrypt with the wrong key fails', async () => {
	const keyA = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	const keyB = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	const blob = await encrypt('secret', keyA);
	await expect(decrypt(blob, keyB)).rejects.toThrow();
});

test('tampered ciphertext fails GCM auth', async () => {
	const key = await loadEncryptionKey({ ENCRYPTION_KEY: randomKey() });
	const blob = await encrypt('secret', key);
	const bytes = Uint8Array.from(Buffer.from(blob, 'base64'));
	bytes[bytes.length - 1] ^= 0xff;
	const tampered = Buffer.from(bytes).toString('base64');
	await expect(decrypt(tampered, key)).rejects.toThrow();
});
