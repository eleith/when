import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';

export interface AppState {
	config: WhenConfiguration;
	db: Kysely<Database>;
}

let state: AppState | null = null;

export function setState(s: AppState): void {
	state = s;
}

export function getState(): AppState {
	if (!state) throw new Error('app state not initialized — bootApp() must run first');
	return state;
}

export function getConfig(): WhenConfiguration {
	return getState().config;
}

export function getDb(): Kysely<Database> {
	return getState().db;
}
