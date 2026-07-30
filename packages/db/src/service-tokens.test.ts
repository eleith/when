import { beforeEach, describe, expect, test } from 'vitest';
import type { Kysely } from 'kysely';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import {
	getServiceRefreshToken,
	saveServiceRefreshToken,
	deleteServiceToken,
	recordServiceTokenError,
	listServiceConnections
} from './service-tokens.js';
import type { Database } from './types.js';

describe('service tokens', () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = openDb(':memory:');
		await runMigrations(db);
	});

	test('returns null for a service that was never connected', async () => {
		expect(await getServiceRefreshToken(db, 'my-google')).toBeNull();
	});

	test('saves and reads back a refresh token', async () => {
		await saveServiceRefreshToken(db, 'my-google', 'rt-1');
		expect(await getServiceRefreshToken(db, 'my-google')).toBe('rt-1');
	});

	test('keeps services independent', async () => {
		await saveServiceRefreshToken(db, 'work', 'rt-work');
		await saveServiceRefreshToken(db, 'personal', 'rt-personal');
		expect(await getServiceRefreshToken(db, 'work')).toBe('rt-work');
		expect(await getServiceRefreshToken(db, 'personal')).toBe('rt-personal');
	});

	test('reconnecting replaces the token and clears the previous error', async () => {
		await saveServiceRefreshToken(db, 'my-google', 'rt-1');
		await recordServiceTokenError(db, 'my-google', 'invalid_grant');
		expect((await listServiceConnections(db))[0].lastError).toBe('invalid_grant');

		await saveServiceRefreshToken(db, 'my-google', 'rt-2');

		expect(await getServiceRefreshToken(db, 'my-google')).toBe('rt-2');
		const [connection] = await listServiceConnections(db);
		expect(connection.lastError).toBeNull();
	});

	test('recording an error keeps the row so broken differs from never connected', async () => {
		await saveServiceRefreshToken(db, 'my-google', 'rt-1');
		await recordServiceTokenError(db, 'my-google', 'invalid_grant');

		expect(await getServiceRefreshToken(db, 'my-google')).toBe('rt-1');
		const [connection] = await listServiceConnections(db);
		expect(connection).toMatchObject({ serviceName: 'my-google', lastError: 'invalid_grant' });
		expect(connection.connectedAt).toBeTruthy();
	});

	test('recording an error against an unknown service is a no-op', async () => {
		await recordServiceTokenError(db, 'nope', 'invalid_grant');
		expect(await listServiceConnections(db)).toEqual([]);
	});

	test('deleting removes the connection entirely', async () => {
		await saveServiceRefreshToken(db, 'my-google', 'rt-1');
		await deleteServiceToken(db, 'my-google');

		expect(await getServiceRefreshToken(db, 'my-google')).toBeNull();
		expect(await listServiceConnections(db)).toEqual([]);
	});

	test('deleting an unknown service is a no-op', async () => {
		await saveServiceRefreshToken(db, 'keep', 'rt-1');
		await deleteServiceToken(db, 'nope');
		expect(await listServiceConnections(db)).toHaveLength(1);
	});

	test('lists connections by name without exposing the credential', async () => {
		await saveServiceRefreshToken(db, 'work', 'rt-work');
		await saveServiceRefreshToken(db, 'personal', 'rt-personal');

		const connections = await listServiceConnections(db);
		expect(connections.map((c) => c.serviceName)).toEqual(['personal', 'work']);
		expect(JSON.stringify(connections)).not.toContain('rt-work');
	});
});
