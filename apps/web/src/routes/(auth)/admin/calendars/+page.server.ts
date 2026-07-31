import { getConfig, getDb } from '$lib/server/state';
import { listCalendars, probeCalendar } from '$lib/server/calendar/status';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		crumb: 'Calendars',
		calendars: await listCalendars(getConfig(), getDb())
	};
};

export const actions: Actions = {
	test: async ({ request }) => {
		const name = String((await request.formData()).get('calendar') ?? '');
		const result = await probeCalendar(getConfig(), getDb(), name);
		return {
			notice: result.ok
				? { tone: 'success', text: `${name} — ${result.message}` }
				: { tone: 'error', text: `${name} could not be reached — ${result.message}` }
		};
	}
};
