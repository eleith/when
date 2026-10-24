import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, parseActionLog, runMigrations, type Appointment } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { changeAppointmentDuration } from './change-duration';
import { resolveDuration } from './duration';
import { rescheduleAppointment, type RescheduleAppointmentInput } from './reschedule';
import type { AppointmentContext } from './context';
import type { AppointmentRole } from './actions';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

const appointmentId = 'duration-race';
const now = new Date('2099-01-01T12:00:00Z');
const newStart = '2099-01-06T10:00:00Z';
const initialHistory = [{ action: 'create', actor: 'guest', at: '2098-12-01T12:00:00Z' }];
let db: ReturnType<typeof openDb>;
let ctx: AppointmentContext;

async function currentRow() {
	const row = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirstOrThrow();
	return row;
}

function prevalidate(
	row: Appointment,
	role: AppointmentRole,
	duration: number
): RescheduleAppointmentInput {
	const form = new FormData();
	form.set('duration', String(duration));
	const resolved = resolveDuration(ctx.cfg.meetings[row.event_type_id], role, form, row);
	expect(resolved).toBe(duration);
	return {
		appointmentId: row.id,
		initiator: role,
		newStart,
		newEnd: Temporal.Instant.from(newStart).add({ minutes: duration }).toString()
	};
}

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	const cfg = structuredClone(validConfig);
	cfg.meetings['30-min-chat'].duration_minutes = 30;
	cfg.meetings['30-min-chat'].additional_duration_minutes = [];
	ctx = { db, cfg, clock: { now: () => now, nowMs: () => now.getTime() } };
	await db
		.insertInto('appointments')
		.values({
			id: appointmentId,
			event_type_id: '30-min-chat',
			start_time: '2099-01-05T10:00:00Z',
			end_time: '2099-01-05T11:30:00Z',
			status: 'confirmed',
			origin_id: appointmentId,
			cancel_token: 'original-token',
			guest_name: 'Guest',
			guest_email: 'guest@example.com',
			location: 'Existing location',
			note: 'Existing host note',
			video_chat: 'https://video.example/keep',
			video_chat_request: 'suppress',
			external_event_id: 'published-event',
			external_calendar_id: 'my-google-cal',
			action_log: JSON.stringify(initialHistory)
		})
		.execute();
	vi.mocked(enqueueAppointmentReconciliation).mockReset();
	vi.mocked(enqueueAppointmentReconciliation).mockResolvedValue(undefined);
});

afterEach(async () => {
	await db.destroy();
});

describe('duration change between reschedule prevalidation and commit', () => {
	test('gates a guest request retaining stale 90 minutes after the host commits 60 minutes', async () => {
		const page = await currentRow();
		const request = prevalidate(page, 'guest', 90);

		const changed = await changeAppointmentDuration(ctx, { appointmentId, durationMinutes: 60 });
		const committed = await currentRow();
		expect(changed).toEqual({ ok: true, outcome: 'updated', appointment: committed });
		expect(committed).toMatchObject({
			status: 'confirmed',
			start_time: page.start_time,
			end_time: '2099-01-05T11:00:00Z',
			calendar_revision: 1,
			ics_sequence: 1
		});
		expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
			committed,
			'edited-by-host'
		);

		const result = await rescheduleAppointment(ctx, request);
		const rows = await db.selectFrom('appointments').selectAll().execute();
		expect(result).toEqual({ ok: false, reason: 'gated' });
		expect(rows).toEqual([committed]);
		expect(parseActionLog(rows[0].action_log)).toEqual([
			...initialHistory,
			{
				action: 'edit',
				actor: 'host',
				at: now.toISOString(),
				payload: {
					metadata: { changes: ['duration_updated'], previous_duration: 90, duration: 60 }
				}
			}
		]);
		expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
			committed,
			'edited-by-host'
		);
	});

	test.each([
		{
			name: 'guest requested configured 30 before the host change',
			role: 'guest',
			savedDuration: 60,
			requestedDuration: 30,
			validateFresh: false
		},
		{
			name: 'guest retains fresh 60 after the host change',
			role: 'guest',
			savedDuration: 60,
			requestedDuration: 60,
			validateFresh: true
		},
		{
			name: 'guest retains unchanged original 90',
			role: 'guest',
			savedDuration: 90,
			requestedDuration: 90,
			validateFresh: false
		},
		{
			name: 'host still chooses host-only 90 after saving 60',
			role: 'host',
			savedDuration: 60,
			requestedDuration: 90,
			validateFresh: false
		}
	] as const)(
		'$name remains allowed',
		async ({ role, savedDuration, requestedDuration, validateFresh }) => {
			const page = await currentRow();
			let request = validateFresh ? undefined : prevalidate(page, role, requestedDuration);
			const changed = await changeAppointmentDuration(ctx, {
				appointmentId,
				durationMinutes: savedDuration
			});
			const committed = await currentRow();
			const durationChanged = savedDuration !== 90;
			expect(changed).toEqual({
				ok: true,
				outcome: durationChanged ? 'updated' : 'unchanged',
				appointment: committed
			});
			if (validateFresh) request = prevalidate(committed, role, requestedDuration);
			if (!request) throw new Error('control request was not prevalidated');

			const result = await rescheduleAppointment(ctx, request);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(`control reschedule refused: ${result.reason}`);
			const rows = await db.selectFrom('appointments').selectAll().execute();
			const original = rows.find((row) => row.id === appointmentId);
			const successor = rows.find((row) => row.id === result.appointment.id);
			expect(rows).toHaveLength(2);
			expect(successor).toEqual(result.appointment);
			expect(result.appointment.id).not.toBe(appointmentId);
			expect(result.appointment).toMatchObject({
				status: 'confirmed',
				origin_id: appointmentId,
				start_time: newStart,
				end_time: request.newEnd,
				note: committed.note,
				video_chat: committed.video_chat,
				video_chat_request: committed.video_chat_request,
				ics_sequence: committed.ics_sequence + 1
			});
			expect(original).toMatchObject({
				status: 'rescheduled',
				start_time: page.start_time,
				end_time: committed.end_time,
				calendar_revision: committed.calendar_revision,
				ics_sequence: committed.ics_sequence
			});
			const history = parseActionLog(result.appointment.action_log);
			expect(history.slice(0, -1)).toEqual(parseActionLog(committed.action_log));
			expect(history.at(-1)).toMatchObject({
				action: 'reschedule',
				actor: role,
				payload: { metadata: { previous_id: appointmentId, next_id: result.appointment.id } }
			});
			expect(original?.action_log).toBe(result.appointment.action_log);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(durationChanged ? 2 : 1);
			if (durationChanged) {
				expect(enqueueAppointmentReconciliation).toHaveBeenNthCalledWith(
					1,
					committed,
					'edited-by-host'
				);
			}
			expect(enqueueAppointmentReconciliation).toHaveBeenLastCalledWith(
				result.appointment,
				`rescheduled-by-${role}`
			);
		}
	);
});
