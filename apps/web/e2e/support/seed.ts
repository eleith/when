import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createActionLog, openDb, type Appointment, type AppointmentStatus } from '@when/db';

const DB_PATH = fileURLToPath(new URL('../fixture/data/when.sqlite', import.meta.url));

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// `event_type_id` holds the meeting's name, not its slug.
export const CHAT_MEETING = {
	name: '30-minute chat',
	slug: 'chat',
	durationMinutes: 30
};

// Live rows are unique on (event_type_id, start_time), and workers are separate processes.
let seedsInThisWorker = 0;
function unusedStart(): Date {
	const offsetSeconds = (process.pid % 10_000) * 10 + seedsInThisWorker++;
	return new Date(Date.now() + DAY_MS + offsetSeconds * 1000);
}

export interface SeedAppointmentOptions {
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
	const db = openDb(DB_PATH);

	try {
		return await db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: CHAT_MEETING.name,
				start_time: start.toISOString(),
				end_time: new Date(start.getTime() + durationMinutes * MINUTE_MS).toISOString(),
				guest_name: options.guestName ?? `Guest ${id.slice(4, 12)}`,
				guest_email: options.guestEmail ?? 'guest@example.test',
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
	} finally {
		await db.destroy();
	}
}
