import { randomUUID } from 'node:crypto';
import { createActionLog, openDb, type Appointment, type AppointmentStatus } from '@when/db';
import { APP_DB_PATH } from './database.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// The meeting's key is both its URL slug and its `event_type_id`.
export const CHAT_MEETING = {
	slug: 'chat',
	title: '30-minute chat',
	durationMinutes: 30
};

// Live rows in the same test are unique on (event_type_id, start_time).
// A month out so seeds do not occupy the near days a booking journey picks.
let seedsInThisWorker = 0;
function unusedStart(): Date {
	return new Date(Date.now() + 30 * DAY_MS + seedsInThisWorker++ * MINUTE_MS);
}

export interface SeedAppointmentOptions {
	eventTypeId?: string;
	status?: AppointmentStatus;
	start?: Date;
	durationMinutes?: number;
	guestName?: string;
	guestEmail?: string | null;
}

export async function seedAppointment(options: SeedAppointmentOptions = {}): Promise<Appointment> {
	const start = options.start ?? unusedStart();
	const durationMinutes = options.durationMinutes ?? CHAT_MEETING.durationMinutes;
	const id = `e2e-${randomUUID()}`;
	const db = openDb(APP_DB_PATH);

	try {
		const appointment = await db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: options.eventTypeId ?? CHAT_MEETING.slug,
				start_time: start.toISOString(),
				end_time: new Date(start.getTime() + durationMinutes * MINUTE_MS).toISOString(),
				guest_name: options.guestName ?? `Guest ${id.slice(4, 12)}`,
				guest_email: options.guestEmail === undefined ? 'guest@example.test' : options.guestEmail,
				guest_answers: null,
				guest_timezone: 'UTC',
				location: null,
				note: null,
				video_chat: null,
				status: options.status ?? 'pending',
				origin_id: id,
				cancel_token: `token-${randomUUID()}`,
				action_log: createActionLog([
					{ action: 'create', actor: 'guest', at: new Date().toISOString() }
				]),
				external_event_id: null,
				external_calendar_id: null,
				// Only read when the meeting is gone from config.
				meeting_snapshot: null
			})
			.returningAll()
			.executeTakeFirstOrThrow();
		return appointment;
	} finally {
		await db.destroy();
	}
}
