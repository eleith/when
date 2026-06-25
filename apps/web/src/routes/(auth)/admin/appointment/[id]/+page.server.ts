import { fail, redirect } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { findAppointment, isChainTerminal } from '@when/db';
import { acceptAppointment } from '$lib/server/appointment/accept';
import { declineAppointment } from '$lib/server/appointment/decline';
import { cancelAppointment } from '$lib/server/appointment/cancel';
import { purgeAppointment } from '$lib/server/appointment/purge';
import { editAppointment } from '$lib/server/appointment/edit';
import { validateReason } from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import type { Actions, PageServerLoad } from './$types';
import { systemClock } from '$lib/server/clock';

export const load: PageServerLoad = async ({ params }) => {
	// A direct GET request redirects back to the public appointment detail page.
	redirect(303, `/appointment/${params.id}`);
};

export const actions: Actions = {
	accept: async ({ params }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const result = await acceptAppointment(appointmentContext(), { appointment: row });
		if (!result.ok) {
			return fail(409, { error: 'This appointment can no longer be accepted.' });
		}
		return { success: 'accepted' };
	},

	decline: async ({ params }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const result = await declineAppointment(appointmentContext(), { appointment: row });
		if (!result.ok) {
			return fail(409, { error: 'This appointment can no longer be declined.' });
		}
		return { success: 'declined' };
	},

	cancel: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const form = await request.formData();
		const reasonResult = validateReason(form, 'cancelling');
		if (!reasonResult.ok) return fail(400, { error: reasonResult.error });

		const result = await cancelAppointment(appointmentContext(), {
			appointment: row,
			initiator: 'host',
			reason: reasonResult.reason
		});
		if (!result.ok) {
			return fail(409, { error: 'This appointment can no longer be cancelled.' });
		}
		return { success: 'cancelled' };
	},

	delete: async ({ params }) => {
		const db = getDb();
		const row = await findAppointment(db, params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const cfg = getConfig();
		const eventType = cfg.event_types.find((e) => e.id === row.event_type_id);

		if (eventType) {
			const check = await isChainTerminal(db, row.id, systemClock.now());
			if (!check.terminal) {
				return fail(400, {
					error:
						check.reason === 'not_terminal'
							? 'Delete blocked: cannot delete an active or upcoming appointment.'
							: 'This appointment is not eligible for deletion.'
				});
			}
		}

		await purgeAppointment(appointmentContext(), { appointment: row });

		redirect(303, '/admin/appointments/upcoming');
	},

	edit: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const form = await request.formData();
		const noteInput = form.get('note');
		const note = typeof noteInput === 'string' ? noteInput.trim() || null : undefined;

		const result = await editAppointment(appointmentContext(), {
			appointment: row,
			note
		});

		if (!result.ok) {
			if (result.reason === 'gated') {
				return fail(400, { error: 'This appointment cannot be edited.' });
			}
			if (result.reason === 'no_changes') {
				return { success: 'no_change' };
			}
			return fail(409, { error: 'This appointment can no longer be edited.' });
		}

		return { success: 'edited' };
	}
};
