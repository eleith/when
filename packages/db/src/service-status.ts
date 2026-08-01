import { type Kysely } from 'kysely';
import type { Database, ServiceStatus } from './types.js';

/** What kind of external dependency a status row is about. */
export type ServiceKind = 'calendar' | 'provider' | 'smtp' | 'video_chat';

/** What observed the outcome: real work, or a human asking. */
export type ObservedVia = 'refresh' | 'push' | 'send' | 'test';

/** Which dependency. Kinds with a single instance, like `smtp`, carry no name. */
export interface ServiceRef {
	kind: ServiceKind;
	name?: string;
}

export interface ServiceOutcome {
	at: string;
	via: ObservedVia;
	error?: string | null;
}

/**
 * Record what an interaction proved about a dependency.
 *
 * `failing_since` survives a streak — it is only set on the healthy→failing transition — so
 * it reads as "failing since" rather than "last failed".
 */
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

/** Every observed dependency, or just those of one kind. */
export function listServiceStatus(
	db: Kysely<Database>,
	kind?: ServiceKind
): Promise<ServiceStatus[]> {
	const query = db.selectFrom('service_status').selectAll();
	return (kind === undefined ? query : query.where('kind', '=', kind)).execute();
}
