import { fail, redirect } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { findAppointment, isChainTerminal } from '@when/db';
import { acceptAppointment } from '$lib/server/appointment/accept';
import { declineAppointment } from '$lib/server/appointment/decline';
import { cancelAppointment } from '$lib/server/appointment/cancel';
import { purgeAppointment } from '$lib/server/appointment/purge';
import { editAppointment } from '$lib/server/appointment/edit';
import { changeAppointmentDuration } from '$lib/server/appointment/change-duration';
import { validateDeclineNote, validateReason } from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import { rotateGuestTokenTransition } from '$lib/server/appointment/transitions';
import { requestVideoChat } from '$lib/server/appointment/request-video-chat';
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

	decline: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });
		const form = await request.formData();
		const noteResult = validateDeclineNote(form);
		if (!noteResult.ok) return fail(400, { error: noteResult.error });

		const result = await declineAppointment(appointmentContext(), {
			appointment: row,
			note: noteResult.note
		});
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
		const eventType = cfg.meetings[row.event_type_id];

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

	rotate: async ({ params }) => {
		const result = await rotateGuestTokenTransition(
			getDb(),
			params.id,
			systemClock.now().toISOString()
		);
		if (!result.ok) {
			return result.reason === 'not_found'
				? fail(404, { error: 'Appointment not found.' })
				: fail(409, { error: 'Only the current appointment in a chain has a link to rotate.' });
		}
		return { success: 'rotated' };
	},

	edit: async ({ params, request }) => {
		const row = await findAppointment(getDb(), params.id);
		if (!row) return fail(404, { error: 'Appointment not found.' });

		const form = await request.formData();
		const noteInput = form.get('note');
		const note = typeof noteInput === 'string' ? noteInput.trim() || null : undefined;

		const locationInput = form.get('location');
		const location = typeof locationInput === 'string' ? locationInput.trim() || null : undefined;

		const videoChatInput = form.get('video_chat');
		const videoChat =
			typeof videoChatInput === 'string' ? videoChatInput.trim() || null : undefined;

		if (videoChat) {
			try {
				new URL(videoChat);
			} catch {
				return fail(400, { error: 'Please enter a valid video link URL.' });
			}
		}

		const result = await editAppointment(appointmentContext(), {
			appointmentId: row.id,
			note,
			location,
			video_chat: videoChat
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
	},

	changeDuration: async ({ params, request }) => {
		const form = await request.formData();
		const value = form.get('duration');
		if (typeof value !== 'string' || !value.trim()) {
			return fail(400, { error: 'Please pick a valid meeting length.' });
		}
		const durationMinutes = Number(value);
		if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
			return fail(400, { error: 'Please pick a valid meeting length.' });
		}
		const result = await changeAppointmentDuration(appointmentContext(), {
			appointmentId: params.id,
			durationMinutes
		});
		if (!result.ok) {
			switch (result.reason) {
				case 'not_found':
					return fail(404, { error: 'Appointment not found.' });
				case 'not_configured':
					return fail(409, { error: 'This meeting type no longer exists.' });
				case 'invalid_duration':
					return fail(400, { error: 'Please pick a valid meeting length.' });
				case 'past_end':
					return fail(400, { error: 'Choose a length that ends in the future.' });
				case 'gated':
					return fail(400, { error: 'This appointment cannot be edited.' });
				case 'busy':
					return fail(409, { error: 'That length overlaps another appointment or busy event.' });
				case 'enqueue_failed':
					return fail(500, {
						error:
							'The duration was saved, but calendar and email update submission could not be confirmed.',
						durationSaved: true
					});
			}
		}
		if (result.outcome === 'unchanged') return { success: 'no_change' };
		return { success: 'duration_changed' };
	},

	generateVideoChat: async ({ params }) => {
		const result = await requestVideoChat(appointmentContext(), { appointmentId: params.id });
		if (!result.ok) {
			if (result.reason === 'not_found') {
				return fail(404, { error: 'Appointment not found.' });
			}
			if (result.reason === 'not_configured') {
				return fail(400, { error: 'This meeting type does not have video chat configured.' });
			}
			if (result.reason === 'gated') {
				return fail(400, { error: 'This appointment cannot generate a video chat link.' });
			}
			return fail(500, {
				error:
					'Your video chat choice was saved, but submission could not be confirmed. Please try again.',
				choiceSaved: true
			});
		}
		return {
			success:
				result.outcome === 'already_linked' ? 'video_chat_already_linked' : 'video_chat_requested'
		};
	}
};
