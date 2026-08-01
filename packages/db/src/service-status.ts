import { type Kysely } from 'kysely';
import type { Database, ServiceStatus } from './types.js';

export type ServiceKind = 'calendar' | 'provider' | 'smtp' | 'video_chat';

export type ObservedVia = 'refresh' | 'push' | 'send' | 'test';

export interface ServiceRef {
	kind: ServiceKind;
	name?: string;
}

export interface ServiceOutcome {
	at: string;
	via: ObservedVia;
	error?: string | null;
}

// failing_since is set only on the healthy-to-failing transition, so it reads as "since".
export async function recordServiceOutcome(
	db: Kysely<Database>,
	ref: ServiceRef,
	outcome: ServiceOutcome
): Promise<void> {
	const ok = !outcome.error;
	const name = ref.name ?? '';

	await db
		.insertInto('service_status')
		.values({
			kind: ref.kind,
			name,
			last_attempt_at: outcome.at,
			last_ok_at: ok ? outcome.at : null,
			failing_since: ok ? null : outcome.at,
			error: ok ? null : outcome.error,
			via: outcome.via
		})
		.onConflict((oc) =>
			oc.columns(['kind', 'name']).doUpdateSet(
				ok
					? {
							last_attempt_at: outcome.at,
							last_ok_at: outcome.at,
							failing_since: null,
							error: null,
							via: outcome.via
						}
					: (eb) => ({
							last_attempt_at: outcome.at,
							failing_since: eb.fn.coalesce('service_status.failing_since', eb.val(outcome.at)),
							error: outcome.error,
							via: outcome.via
						})
			)
		)
		.execute();
}

export function listServiceStatus(
	db: Kysely<Database>,
	kind?: ServiceKind
): Promise<ServiceStatus[]> {
	const query = db.selectFrom('service_status').selectAll();
	return (kind === undefined ? query : query.where('kind', '=', kind)).execute();
}
