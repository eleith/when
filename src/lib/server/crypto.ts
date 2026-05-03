const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

export async function loadEncryptionKey(raw: string): Promise<CryptoKey> {
	const decoded = base64ToBytes(raw);
	if (decoded.length !== KEY_LENGTH) {
		throw new Error(
			`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${decoded.length}); use base64 of 32 random bytes`
		);
	}
	return crypto.subtle.importKey('raw', new Uint8Array(decoded), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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
	return bytesToBase64(combined);
}

export async function decrypt(blob: string, key: CryptoKey): Promise<string> {
	const decoded = base64ToBytes(blob);
	if (decoded.length <= IV_LENGTH) {
		throw new Error('ciphertext too short');
	}
	const iv = decoded.slice(0, IV_LENGTH);
	const ciphertext = decoded.slice(IV_LENGTH);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new TextDecoder().decode(plaintext);
}
