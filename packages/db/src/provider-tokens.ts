import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

// No refresh_token: this is the shape the admin page renders.
export interface ProviderConnection {
	providerName: string;
	connectedAt: string;
}

export async function getProviderRefreshToken(
	db: Kysely<Database>,
	providerName: string
): Promise<string | null> {
	const row = await db
		.selectFrom('oauth_tokens')
		.select('refresh_token')
		.where('provider_name', '=', providerName)
		.executeTakeFirst();
	return row?.refresh_token ?? null;
}

export async function saveProviderRefreshToken(
	db: Kysely<Database>,
	providerName: string,
	refreshToken: string
): Promise<void> {
	await db
		.insertInto('oauth_tokens')
		.values({ provider_name: providerName, refresh_token: refreshToken })
		.onConflict((oc) =>
			oc.column('provider_name').doUpdateSet({
				refresh_token: refreshToken,
				connected_at: sql`CURRENT_TIMESTAMP`,
				updated_at: sql`CURRENT_TIMESTAMP`
			})
		)
		.execute();
}

export async function deleteProviderToken(
	db: Kysely<Database>,
	providerName: string
): Promise<void> {
	await db.deleteFrom('oauth_tokens').where('provider_name', '=', providerName).execute();
}

export async function listProviderConnections(db: Kysely<Database>): Promise<ProviderConnection[]> {
	const rows = await db
		.selectFrom('oauth_tokens')
		.select(['provider_name', 'connected_at'])
		.orderBy('provider_name')
		.execute();
	return rows.map((r) => ({
		providerName: r.provider_name,
		connectedAt: r.connected_at
	}));
}
