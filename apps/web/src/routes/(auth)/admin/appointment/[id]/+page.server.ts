import { fail, redirect } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { findAppointment, isChainTerminal, deleteChain, originId } from '@when/db';
import { acceptAppointment } from '$lib/server/appointment/accept';
import { declineAppointment } from '$lib/server/appointment/decline';
import { cancelAppointment } from '$lib/server/appointment/cancel';
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
			initiator: 'organizer',
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
			const now = systemClock.now();
			const check = await isChainTerminal(db, row.id, now);
			if (!check.terminal) {
				let errorMsg = 'This appointment is not eligible for deletion.';
				if (check.reason === 'notifications_queued') {
					errorMsg =
						'Delete blocked: background notifications or calendar sync are still in progress.';
				} else if (check.reason === 'not_terminal') {
					errorMsg = 'Delete blocked: cannot delete an active or upcoming appointment.';
				}
				return fail(400, { error: errorMsg });
			}
		}

		// Delete the entire chain
		const chainOriginId = originId(row);
		await deleteChain(db, chainOriginId);

		redirect(303, '/admin/appointments/upcoming');
	}
};
