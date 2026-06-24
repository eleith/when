import { fail, redirect } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { findAppointment, isChainTerminal } from '@when/db';
import { purgeAppointment } from '$lib/server/appointment/purge';
import { appointmentContext } from '$lib/server/appointment/context';
import { systemClock } from '$lib/server/clock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(307, '/admin/appointments/upcoming');
};

export const actions: Actions = {
	bulkDelete: async ({ request }) => {
		const db = getDb();
		const cfg = getConfig();
		const now = systemClock.now();
		const form = await request.formData();
		const ids = form.getAll('ids') as string[];

		if (!ids || ids.length === 0) {
			return fail(400, { error: 'No appointments selected for deletion.' });
		}

		let deletedCount = 0;
		const errors: string[] = [];

		for (const id of ids) {
			try {
				const row = await findAppointment(db, id);
				if (!row) {
					errors.push(`Appointment ${id} not found.`);
					continue;
				}

				const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);
				if (eventType) {
					const check = await isChainTerminal(db, row.id, now);
					if (!check.terminal) {
						errors.push(
							check.reason === 'not_terminal'
								? `Delete blocked: Appointment for ${row.guest_name} is active/upcoming.`
								: `Appointment ${id} is not eligible for deletion.`
						);
						continue;
					}
				}

				const result = await purgeAppointment(appointmentContext(), { appointment: row });
				if (result.ok) {
					deletedCount++;
				} else {
					errors.push(`Failed to delete appointment for ${row.guest_name}: ${result.reason}`);
				}
			} catch (e: any) {
				errors.push(`Error deleting appointment ${id}: ${e.message || String(e)}`);
			}
		}

		if (errors.length > 0) {
			return fail(400, {
				successCount: deletedCount,
				error: `Deleted ${deletedCount} appointment(s). Errors: ${errors.join('; ')}`
			});
		}

		return { success: `Successfully deleted ${deletedCount} appointment(s).` };
	}
};
