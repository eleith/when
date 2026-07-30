import { beforeEach, expect, test } from 'vitest';
import { openDb, runMigrations, saveServiceRefreshToken } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { connectedServices } from './services.js';

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
});

function configWith(services: WhenConfiguration['services']): WhenConfiguration {
	return { services } as WhenConfiguration;
}

const googleService = {
	name: 'my-google',
	type: 'google' as const,
	client_id: 'cid',
	client_secret: 'csec',
	refresh_token: 'from-config'
};

const caldavService = {
	name: 'my-dav',
	type: 'caldav' as const,
	url: 'https://dav.example.com/',
	username: 'u',
	password: 'p'
};

test('fills a google refresh token from the store', async () => {
	await saveServiceRefreshToken(db, 'my-google', 'from-store');

	const [service] = await connectedServices(configWith([googleService]), db);

	expect(service).toMatchObject({ name: 'my-google', refresh_token: 'from-store' });
});

test('the store wins over anything left in the config', async () => {
	await saveServiceRefreshToken(db, 'my-google', 'from-store');

	const [service] = await connectedServices(configWith([googleService]), db);

	expect(service.type === 'google' && service.refresh_token).toBe('from-store');
});

test('an unconnected google service resolves to a null token', async () => {
	const [service] = await connectedServices(configWith([googleService]), db);

	expect(service.type === 'google' && service.refresh_token).toBeNull();
});

test('only the named service is filled', async () => {
	await saveServiceRefreshToken(db, 'other', 'not-mine');

	const [service] = await connectedServices(configWith([googleService]), db);

	expect(service.type === 'google' && service.refresh_token).toBeNull();
});

test('non-google services pass through untouched', async () => {
	const [service] = await connectedServices(configWith([caldavService]), db);

	expect(service).toEqual(caldavService);
});

test('tolerates a config with no services', async () => {
	expect(await connectedServices(configWith(undefined), db)).toEqual([]);
});
