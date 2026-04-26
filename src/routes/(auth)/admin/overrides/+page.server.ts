import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/state';
import type { Actions, PageServerLoad } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const load: PageServerLoad = async ({ fetch }) => {
	const csrfRes = await fetch('/auth/csrf');
	const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

	const rows = await getDb()
		.selectFrom('availability_overrides')
		.selectAll()
		.orderBy('date', 'asc')
		.execute();

	return { csrfToken, overrides: rows };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const form = await request.formData();
		const date = String(form.get('date') ?? '').trim();
		const startTime = String(form.get('start_time') ?? '').trim();
		const endTime = String(form.get('end_time') ?? '').trim();
		const reason = String(form.get('reason') ?? '').trim();

		if (!DATE_RE.test(date)) {
			return fail(400, { error: 'Date must be YYYY-MM-DD.' });
		}

		const hasStart = startTime !== '';
		const hasEnd = endTime !== '';
		if (hasStart !== hasEnd) {
			return fail(400, { error: 'Provide both start and end times, or leave both blank.' });
		}
		if (hasStart && (!TIME_RE.test(startTime) || !TIME_RE.test(endTime))) {
			return fail(400, { error: 'Times must be HH:MM.' });
		}
		if (hasStart && startTime >= endTime) {
			return fail(400, { error: 'Start time must be before end time.' });
		}

		await getDb()
			.insertInto('availability_overrides')
			.values({
				id: crypto.randomUUID(),
				date,
				start_time: hasStart ? startTime : null,
				end_time: hasEnd ? endTime : null,
				reason: reason || null
			})
			.execute();

		return { added: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Missing id.' });
		await getDb().deleteFrom('availability_overrides').where('id', '=', id).execute();
		return { deleted: true };
	}
};
