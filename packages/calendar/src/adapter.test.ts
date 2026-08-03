import { beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, saveProviderRefreshToken } from '@when/db';
import type { Provider } from '@when/config';
import { connectProvider, connectProviders } from './adapter.js';

const google: Provider = {
	type: 'google',
	client_id: 'cid',
	client_secret: 'csec',
	calendars: {}
} as Provider;

const dav: Provider = {
	type: 'caldav',
	url: 'https://d.example/',
	username: 'u',
	password: 'p',
	calendars: {}
} as Provider;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
});

describe('connectProvider', () => {
	test('attaches the token to a google service', () => {
		expect(connectProvider(google, 'rt-1')).toMatchObject({ refresh_token: 'rt-1' });
	});

	test('marks a google service with no token as unconnected', () => {
		expect(connectProvider(google, null)).toMatchObject({ refresh_token: null });
	});

	test('leaves a service that keeps its credentials in config untouched', () => {
		expect(connectProvider(dav, 'rt-1')).toEqual(dav);
	});
});

describe('connectProviders', () => {
	test('joins each service with the token the store holds', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');

		const connected = await connectProviders({ gg: google, dav }, db);

		expect(connected.gg).toMatchObject({ refresh_token: 'rt-1' });
		expect(connected.dav).toEqual(dav);
	});

	test('yields a null token for a service that was never connected', async () => {
		const { gg: connected } = await connectProviders({ gg: google }, db);
		expect(connected).toMatchObject({ refresh_token: null });
	});

	test('does not borrow another service token', async () => {
		await saveProviderRefreshToken(db, 'other', 'not-mine');

		const { gg: connected } = await connectProviders({ gg: google }, db);

		expect(connected).toMatchObject({ refresh_token: null });
	});
});
