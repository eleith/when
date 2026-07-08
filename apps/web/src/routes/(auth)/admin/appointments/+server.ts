import { redirect } from '@sveltejs/kit';
import { getConfig, getDb } from '$lib/server/state';
import { findAppointment, isChainTerminal } from '@when/db';
import { purgeAppointment } from '$lib/server/appointment/purge';
import { cancelAppointment } from '$lib/server/appointment/cancel';
import { acceptAppointment } from '$lib/server/appointment/accept';
import { declineAppointment } from '$lib/server/appointment/decline';
import { validateReason } from '$lib/server/appointment/form.server';
import { appointmentContext } from '$lib/server/appointment/context';
import { systemClock } from '$lib/server/clock';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	redirect(307, '/admin/appointments/upcoming');
};

async function handleBulkDelete(ids: string[]): Promise<Response | null> {
	if (!ids || ids.length === 0) {
		return new Response('No appointments selected for deletion.', { status: 400 });
	}

	const db = getDb();
	const cfg = getConfig();
	const now = systemClock.now();
	let deletedCount = 0;
	const errors: string[] = [];

	for (const id of ids) {
		try {
			const row = await findAppointment(db, id);
			if (!row) {
				errors.push(`Appointment ${id} not found.`);
				continue;
			}

			const eventType = cfg.meetings.find((e) => e.name === row.event_type_id);
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
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Error deleting appointment ${id}: ${msg}`);
		}
	}

	if (errors.length > 0) {
		return new Response(`Deleted ${deletedCount} appointment(s). Errors: ${errors.join('; ')}`, {
			status: 400
		});
	}

	return null;
}

async function handleBulkCancel(ids: string[], form: FormData): Promise<Response | null> {
	if (!ids || ids.length === 0) {
		return new Response('No appointments selected for cancellation.', { status: 400 });
	}

	const reasonResult = validateReason(form, 'cancelling');
	if (!reasonResult.ok) {
		return new Response(reasonResult.error, { status: 400 });
	}

	const db = getDb();
	let cancelledCount = 0;
	const errors: string[] = [];

	for (const id of ids) {
		try {
			const row = await findAppointment(db, id);
			if (!row) {
				errors.push(`Appointment ${id} not found.`);
				continue;
			}

			const result = await cancelAppointment(appointmentContext(), {
				appointment: row,
				initiator: 'host',
				reason: reasonResult.reason
			});

			if (result.ok) {
				cancelledCount++;
			} else {
				errors.push(`Failed to cancel appointment for ${row.guest_name}: ${result.reason}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Error cancelling appointment ${id}: ${msg}`);
		}
	}

	if (errors.length > 0) {
		return new Response(
			`Cancelled ${cancelledCount} appointment(s). Errors: ${errors.join('; ')}`,
			{
				status: 400
			}
		);
	}

	return null;
}

async function handleBulkAccept(ids: string[]): Promise<Response | null> {
	if (!ids || ids.length === 0) {
		return new Response('No appointments selected for acceptance.', { status: 400 });
	}

	const db = getDb();
	let acceptedCount = 0;
	const errors: string[] = [];

	for (const id of ids) {
		try {
			const row = await findAppointment(db, id);
			if (!row) {
				errors.push(`Appointment ${id} not found.`);
				continue;
			}

			const result = await acceptAppointment(appointmentContext(), { appointment: row });
			if (result.ok) {
				acceptedCount++;
			} else {
				errors.push(`Failed to accept appointment for ${row.guest_name}: ${result.reason}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Error accepting appointment ${id}: ${msg}`);
		}
	}

	if (errors.length > 0) {
		return new Response(`Accepted ${acceptedCount} appointment(s). Errors: ${errors.join('; ')}`, {
			status: 400
		});
	}

	return null;
}

async function handleBulkDecline(ids: string[]): Promise<Response | null> {
	if (!ids || ids.length === 0) {
		return new Response('No appointments selected for declination.', { status: 400 });
	}

	const db = getDb();
	let declinedCount = 0;
	const errors: string[] = [];

	for (const id of ids) {
		try {
			const row = await findAppointment(db, id);
			if (!row) {
				errors.push(`Appointment ${id} not found.`);
				continue;
			}

			const result = await declineAppointment(appointmentContext(), { appointment: row });
			if (result.ok) {
				declinedCount++;
			} else {
				errors.push(`Failed to decline appointment for ${row.guest_name}: ${result.reason}`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Error declining appointment ${id}: ${msg}`);
		}
	}

	if (errors.length > 0) {
		return new Response(`Declined ${declinedCount} appointment(s). Errors: ${errors.join('; ')}`, {
			status: 400
		});
	}

	return null;
}

export const POST: RequestHandler = async ({ request, url }) => {
	const form = await request.formData();
	const ids = form.getAll('ids') as string[];
	const referer = request.headers.get('referer') || '/admin/appointments/upcoming';

	const hasAction = (name: string) =>
		url.searchParams.has(`/${name}`) || url.searchParams.has(name);

	if (hasAction('bulkDelete')) {
		const response = await handleBulkDelete(ids);
		if (response) return response;
	} else if (hasAction('bulkCancel')) {
		const response = await handleBulkCancel(ids, form);
		if (response) return response;
	} else if (hasAction('bulkAccept')) {
		const response = await handleBulkAccept(ids);
		if (response) return response;
	} else if (hasAction('bulkDecline')) {
		const response = await handleBulkDecline(ids);
		if (response) return response;
	} else {
		return new Response('Method Not Allowed', { status: 405 });
	}

	redirect(303, referer);
};
