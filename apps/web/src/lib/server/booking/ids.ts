export function newAppointmentId(): string {
	return `appt-${crypto.randomUUID()}`;
}

export function newCancelToken(): string {
	return `tok-${crypto.randomUUID()}`;
}
