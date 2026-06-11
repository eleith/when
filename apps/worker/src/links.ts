export interface BookingLinks {
	booked: string;
	cancel: string;
	reschedule: string;
	manage: string;
}

// Duplicated from web's booking/links.ts (small + stable; we accept possible
// drift rather than share a package). Builds web's action URLs from the
// configured base URL since the worker has no request to derive one from.
export function bookingLinks(
	baseUrl: string,
	appointment: { id: string; cancel_token: string },
	eventType: { slug: string } | undefined
): BookingLinks {
	const token = encodeURIComponent(appointment.cancel_token);
	const booked = `${baseUrl}/booked/${appointment.id}?token=${token}`;
	return {
		booked,
		cancel: `${booked}&cancel=1`,
		reschedule: eventType
			? `${baseUrl}/schedule/${eventType.slug}?reschedule=${appointment.id}&token=${token}`
			: booked,
		manage: `${baseUrl}/signin?callbackUrl=${encodeURIComponent(`/booked/${appointment.id}`)}`
	};
}
