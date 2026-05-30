import { signOutAction } from '$lib/server/auth';
import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import type { Appointment } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

type DisplayStatus =
	| 'pending'
	| 'confirmed'
	| 'in_progress'
	| 'concluded'
	| 'cancelled'
	| 'declined';

function deriveDisplayStatus(
	row: Pick<Appointment, 'status' | 'start_time' | 'end_time'>,
	now: Date
): DisplayStatus {
	if (row.status !== 'confirmed') return row.status;
	const nowMs = now.getTime();
	if (nowMs < Date.parse(row.start_time)) return 'confirmed';
	if (nowMs < Date.parse(row.end_time)) return 'in_progress';
	return 'concluded';
}

export const load: PageServerLoad = async () => {
	const cfg = getConfig();
	const rows = await getDb()
		.selectFrom('appointments')
		.selectAll()
		.orderBy('start_time', 'desc')
		.execute();

	const now = systemClock.now();
	const nowMs = now.getTime();
	const appointments = rows.map((r) => ({
		...r,
		event_type_name: cfg.event_types.find((e) => e.id === r.event_type_id)?.name ?? r.event_type_id,
		display_status: deriveDisplayStatus(r, now),
		is_past: nowMs >= Date.parse(r.end_time)
	}));

	return { appointments };
};

export const actions: Actions = {
	signout: signOutAction
};
