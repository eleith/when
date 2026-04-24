import { logger } from './logger';

const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export async function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Promise<CryptoKey> {
	const raw = env.ENCRYPTION_KEY;
	const bytes = new Uint8Array(KEY_LENGTH);
	if (raw) {
		const decoded = Buffer.from(raw, 'base64');
		if (decoded.length !== KEY_LENGTH) {
			throw new Error(
				`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${decoded.length}); use base64 of 32 random bytes`
			);
		}
		bytes.set(decoded);
	} else {
		if (env.NODE_ENV === 'production') {
			throw new Error('ENCRYPTION_KEY env var is required in production');
		}
		crypto.getRandomValues(bytes);
		logger.warn(
			'ENCRYPTION_KEY not set — generated an ephemeral dev key. Stored secrets will be lost on restart. Set ENCRYPTION_KEY to persist.'
		);
	}
	return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
	const iv = new Uint8Array(IV_LENGTH);
	crypto.getRandomValues(iv);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
	);
	const combined = new Uint8Array(iv.length + ciphertext.length);
	combined.set(iv, 0);
	combined.set(ciphertext, iv.length);
	return Buffer.from(combined).toString('base64');
}

export async function decrypt(blob: string, key: CryptoKey): Promise<string> {
	const decoded = Buffer.from(blob, 'base64');
	if (decoded.length <= IV_LENGTH) {
		throw new Error('ciphertext too short');
	}
	const combined = new Uint8Array(decoded.length);
	combined.set(decoded);
	const iv = combined.slice(0, IV_LENGTH);
	const ciphertext = combined.slice(IV_LENGTH);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new TextDecoder().decode(plaintext);
}
