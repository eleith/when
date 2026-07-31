import { beforeEach, describe, expect, test } from 'vitest';
import { openDb, runMigrations, saveServiceRefreshToken } from '@when/db';
import type { Service } from '@when/config';
import { connectService, connectServices } from './adapter.js';

const google: Service = {
	name: 'gg',
	type: 'google',
	client_id: 'cid',
	client_secret: 'csec'
} as Service;

const dav: Service = {
	name: 'dav',
	type: 'caldav',
	url: 'https://d.example/',
	username: 'u',
	password: 'p'
} as Service;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
});

describe('connectService', () => {
	test('attaches the token to a google service', () => {
		expect(connectService(google, 'rt-1')).toMatchObject({ name: 'gg', refresh_token: 'rt-1' });
	});

	test('marks a google service with no token as unconnected', () => {
		expect(connectService(google, null)).toMatchObject({ refresh_token: null });
	});

	test('leaves a service that keeps its credentials in config untouched', () => {
		expect(connectService(dav, 'rt-1')).toEqual(dav);
	});
});

describe('connectServices', () => {
	test('joins each service with the token the store holds', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');

		const connected = await connectServices([google, dav], db);

		expect(connected[0]).toMatchObject({ name: 'gg', refresh_token: 'rt-1' });
		expect(connected[1]).toEqual(dav);
	});

	test('yields a null token for a service that was never connected', async () => {
		const [connected] = await connectServices([google], db);
		expect(connected).toMatchObject({ refresh_token: null });
	});

	test('does not borrow another service token', async () => {
		await saveServiceRefreshToken(db, 'other', 'not-mine');

		const [connected] = await connectServices([google], db);

		expect(connected).toMatchObject({ refresh_token: null });
	});
});
