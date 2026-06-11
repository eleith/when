import { sql, type Kysely } from 'kysely';
import type { Clock } from '../clock';
import type { Appointment, AppointmentStatus, AppointmentUpdate, Database } from '@when/db';

export interface TransitionStatusDeps {
	db: Kysely<Database>;
	clock: Clock;
}

export interface TransitionStatusInput {
	id: string;
	from: readonly AppointmentStatus[];
	to: AppointmentStatus;
	/** Optional column updates applied atomically with the status write. */
	patch?: Omit<AppointmentUpdate, 'id' | 'status' | 'updated_at'>;
	/** Increment calendar_revision atomically, marking the calendar out of date. */
	bumpCalendarRevision?: boolean;
}

export type TransitionResult =
	| { ok: true; row: Appointment }
	| { ok: false; reason: 'conflict' | 'not_found' };

export async function transitionStatus(
	deps: TransitionStatusDeps,
	input: TransitionStatusInput
): Promise<TransitionResult> {
	const updated = await deps.db
		.updateTable('appointments')
		.set({
			...input.patch,
			status: input.to,
			...(input.bumpCalendarRevision ? { calendar_revision: sql`calendar_revision + 1` } : {}),
			updated_at: deps.clock.now().toISOString()
		})
		.where('id', '=', input.id)
		.where('status', 'in', [...input.from])
		.returningAll()
		.executeTakeFirst();

	if (updated) return { ok: true, row: updated as Appointment };

	const exists = await deps.db
		.selectFrom('appointments')
		.select('id')
		.where('id', '=', input.id)
		.executeTakeFirst();
	return { ok: false, reason: exists ? 'conflict' : 'not_found' };
}
