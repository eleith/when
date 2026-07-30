import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

// No refresh_token: this is the shape the admin page renders.
export interface ServiceConnection {
	serviceName: string;
	connectedAt: string;
	lastError: string | null;
}

export async function getServiceRefreshToken(
	db: Kysely<Database>,
	serviceName: string
): Promise<string | null> {
	const row = await db
		.selectFrom('oauth_tokens')
		.select('refresh_token')
		.where('service_name', '=', serviceName)
		.executeTakeFirst();
	return row?.refresh_token ?? null;
}

export async function saveServiceRefreshToken(
	db: Kysely<Database>,
	serviceName: string,
	refreshToken: string
): Promise<void> {
	await db
		.insertInto('oauth_tokens')
		.values({ service_name: serviceName, refresh_token: refreshToken })
		.onConflict((oc) =>
			oc.column('service_name').doUpdateSet({
				refresh_token: refreshToken,
				connected_at: sql`CURRENT_TIMESTAMP`,
				last_error: null,
				updated_at: sql`CURRENT_TIMESTAMP`
			})
		)
		.execute();
}

export async function deleteServiceToken(db: Kysely<Database>, serviceName: string): Promise<void> {
	await db.deleteFrom('oauth_tokens').where('service_name', '=', serviceName).execute();
}

// Keeps the row, so "broken" stays distinct from "never connected".
export async function recordServiceTokenError(
	db: Kysely<Database>,
	serviceName: string,
	error: string | null
): Promise<void> {
	await db
		.updateTable('oauth_tokens')
		.set({ last_error: error, updated_at: sql`CURRENT_TIMESTAMP` })
		.where('service_name', '=', serviceName)
		.execute();
}

export async function listServiceConnections(db: Kysely<Database>): Promise<ServiceConnection[]> {
	const rows = await db
		.selectFrom('oauth_tokens')
		.select(['service_name', 'connected_at', 'last_error'])
		.orderBy('service_name')
		.execute();
	return rows.map((r) => ({
		serviceName: r.service_name,
		connectedAt: r.connected_at,
		lastError: r.last_error
	}));
}
