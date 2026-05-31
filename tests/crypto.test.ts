import { expect, test } from 'vitest';
import { decrypt, encrypt, loadEncryptionKey } from '../src/lib/server/crypto';

function randomKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes));
}

function shortKey(): string {
	return btoa('short');
}

test('loadEncryptionKey reads a base64 32-byte key', async () => {
	const key = await loadEncryptionKey(randomKey());
	expect(key.type).toBe('secret');
});

test('loadEncryptionKey rejects wrong-length keys', async () => {
	await expect(loadEncryptionKey(shortKey())).rejects.toThrow(/32 bytes/);
});

test('encrypt/decrypt round-trip', async () => {
	const key = await loadEncryptionKey(randomKey());
	const blob = await encrypt('hello world', key);
	expect(blob).not.toContain('hello');
	const decoded = await decrypt(blob, key);
	expect(decoded).toBe('hello world');
});

test('each encrypt call uses a fresh IV (ciphertext differs)', async () => {
	const key = await loadEncryptionKey(randomKey());
	const a = await encrypt('same plaintext', key);
	const b = await encrypt('same plaintext', key);
	expect(a).not.toBe(b);
});

test('decrypt with the wrong key fails', async () => {
	const keyA = await loadEncryptionKey(randomKey());
	const keyB = await loadEncryptionKey(randomKey());
	const blob = await encrypt('secret', keyA);
	await expect(decrypt(blob, keyB)).rejects.toThrow();
});

test('tampered ciphertext fails GCM auth', async () => {
	const key = await loadEncryptionKey(randomKey());
	const blob = await encrypt('secret', key);
	const decoded = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
	decoded[decoded.length - 1] ^= 0xff;
	const tampered = btoa(String.fromCharCode(...decoded));
	await expect(decrypt(tampered, key)).rejects.toThrow();
});
