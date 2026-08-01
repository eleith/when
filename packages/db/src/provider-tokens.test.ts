import { beforeEach, describe, expect, test } from 'vitest';
import type { Kysely } from 'kysely';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import {
	getProviderRefreshToken,
	saveProviderRefreshToken,
	deleteProviderToken,
	listProviderConnections
} from './provider-tokens.js';
import type { Database } from './types.js';

describe('provider tokens', () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = openDb(':memory:');
		await runMigrations(db);
	});

	test('returns null for a provider that was never connected', async () => {
		expect(await getProviderRefreshToken(db, 'my-google')).toBeNull();
	});

	test('saves and reads back a refresh token', async () => {
		await saveProviderRefreshToken(db, 'my-google', 'rt-1');
		expect(await getProviderRefreshToken(db, 'my-google')).toBe('rt-1');
	});

	test('keeps providers independent', async () => {
		await saveProviderRefreshToken(db, 'work', 'rt-work');
		await saveProviderRefreshToken(db, 'personal', 'rt-personal');
		expect(await getProviderRefreshToken(db, 'work')).toBe('rt-work');
		expect(await getProviderRefreshToken(db, 'personal')).toBe('rt-personal');
	});

	test('reconnecting replaces the token', async () => {
		await saveProviderRefreshToken(db, 'my-google', 'rt-1');
		await saveProviderRefreshToken(db, 'my-google', 'rt-2');

		expect(await getProviderRefreshToken(db, 'my-google')).toBe('rt-2');
		expect(await listProviderConnections(db)).toHaveLength(1);
	});

	test('deleting removes the connection entirely', async () => {
		await saveProviderRefreshToken(db, 'my-google', 'rt-1');
		await deleteProviderToken(db, 'my-google');

		expect(await getProviderRefreshToken(db, 'my-google')).toBeNull();
		expect(await listProviderConnections(db)).toEqual([]);
	});

	test('deleting an unknown provider is a no-op', async () => {
		await saveProviderRefreshToken(db, 'keep', 'rt-1');
		await deleteProviderToken(db, 'nope');
		expect(await listProviderConnections(db)).toHaveLength(1);
	});

	test('lists connections by name without exposing the credential', async () => {
		await saveProviderRefreshToken(db, 'work', 'rt-work');
		await saveProviderRefreshToken(db, 'personal', 'rt-personal');

		const connections = await listProviderConnections(db);
		expect(connections.map((c) => c.providerName)).toEqual(['personal', 'work']);
		expect(JSON.stringify(connections)).not.toContain('rt-work');
	});
});
