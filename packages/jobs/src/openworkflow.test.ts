import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Appointment } from '@when/db';
import {
	initOpenWorkflow,
	getOpenWorkflow,
	getWorkflowRun,
	getStepAttempts
} from './openworkflow.js';
import { sendAppointmentEmail } from './specs.js';
import type { SendAppointmentEmailInput } from './specs.js';

const appointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min',
	start_time: '2026-01-01T10:00:00Z',
	end_time: '2026-01-01T10:30:00Z',
	attendee_name: 'Jane',
	attendee_email: 'jane@example.com',
	attendee_answers: null,
	location: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	rescheduled_from_id: null,
	rescheduled_to_id: null,
	cancel_token: 'tok-1',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	event_type_snapshot: null,
	created_at: '2026-01-01T09:00:00Z',
	updated_at: '2026-01-01T09:00:00Z',
	attendee_timezone: 'America/New_York'
};

describe('client singleton', () => {
	test('getOpenWorkflow throws before initialization', () => {
		expect(() => getOpenWorkflow()).toThrow(/has not been initialized/);
	});

	test('initOpenWorkflow returns a reusable singleton', () => {
		// :memory: backend auto-migrates on connect.
		const client = initOpenWorkflow({ dbPath: ':memory:' });
		expect(client).toBeDefined();
		expect(getOpenWorkflow()).toBe(client);
		// Idempotent: a second init keeps the first instance.
		expect(initOpenWorkflow({ dbPath: ':memory:' })).toBe(client);
	});

	test('the client can enqueue a run (producer-only path)', async () => {
		const input: SendAppointmentEmailInput = {
			kind: 'confirmed',
			appointment
		};

		const handle = await getOpenWorkflow().runWorkflow(sendAppointmentEmail, input);

		expect(handle.workflowRun.id).toBeTruthy();
		expect(handle.workflowRun.status).toBe('pending');
	});
});

describe('read helpers', () => {
	function seedQueueDb(): DatabaseSync {
		const db = new DatabaseSync(':memory:');
		db.exec(`
			CREATE TABLE workflow_runs (
				id TEXT PRIMARY KEY,
				workflow_name TEXT NOT NULL,
				status TEXT NOT NULL,
				error TEXT,
				input TEXT,
				output TEXT,
				finished_at TEXT,
				created_at TEXT NOT NULL
			);
			CREATE TABLE step_attempts (
				id TEXT PRIMARY KEY,
				workflow_run_id TEXT NOT NULL,
				step_name TEXT NOT NULL,
				status TEXT NOT NULL,
				started_at TEXT,
				finished_at TEXT,
				error TEXT,
				created_at TEXT NOT NULL
			);
		`);
		db.prepare(
			`INSERT INTO workflow_runs (id, workflow_name, status, error, input, output, finished_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			'run-1',
			'send-appointment-email',
			'completed',
			null,
			'{}',
			'"sent"',
			null,
			'2026-01-01T10:00:00Z'
		);
		db.prepare(
			`INSERT INTO step_attempts (id, workflow_run_id, step_name, status, started_at, finished_at, error, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			'step-1',
			'run-1',
			'smtp:jane@example.com',
			'completed',
			'2026-01-01T10:00:01Z',
			'2026-01-01T10:00:02Z',
			null,
			'2026-01-01T10:00:01Z'
		);
		db.prepare(
			`INSERT INTO step_attempts (id, workflow_run_id, step_name, status, started_at, finished_at, error, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			'step-2',
			'run-1',
			'status',
			'completed',
			'2026-01-01T10:00:03Z',
			'2026-01-01T10:00:04Z',
			null,
			'2026-01-01T10:00:03Z'
		);
		return db;
	}

	test('getWorkflowRun returns a run by id, or null when missing', () => {
		const db = seedQueueDb();
		const run = getWorkflowRun(db, 'run-1');
		expect(run).not.toBeNull();
		expect(run!.workflow_name).toBe('send-appointment-email');
		expect(run!.status).toBe('completed');
		expect(getWorkflowRun(db, 'missing')).toBeNull();
	});

	test("getStepAttempts lists a run's steps in chronological order", () => {
		const db = seedQueueDb();
		const steps = getStepAttempts(db, 'run-1');
		expect(steps).toHaveLength(2);
		expect(steps[0]).toEqual({
			phase: 'smtp:jane@example.com',
			status: 'completed',
			started_at: '2026-01-01T10:00:01Z',
			finished_at: '2026-01-01T10:00:02Z',
			message: null
		});
		expect(steps[1].phase).toBe('status');
	});
});
