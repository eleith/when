import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import { toAppointmentView } from '$lib/server/appointments';
import { countAppointments, listAppointmentsPage } from '@when/db';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ url }) => {
	const db = getDb();
	const cfg = getConfig();
	const now = systemClock.now();

	const pageParam = url.searchParams.get('page');
	let page = pageParam ? parseInt(pageParam, 10) : 1;
	if (isNaN(page) || page < 1) page = 1;

	const total = await countAppointments(db, { bucket: 'purged', now });
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	if (page > pageCount) page = pageCount;

	const offset = (page - 1) * PAGE_SIZE;
	const rows = await listAppointmentsPage(db, {
		bucket: 'purged',
		now,
		limit: PAGE_SIZE,
		offset
	});

	const appointments = rows.map((r) => toAppointmentView(r, cfg, now));

	return {
		appointments,
		page,
		pageCount
	};
};
