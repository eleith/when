import { describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import type { SendOwnerAlertInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import type { Mailer } from '../email/smtp.js';
import { sampleInput } from '../email/__fixtures__/booking.js';
import { runSendOwnerAlert } from './send-owner-alert.js';

function makeStep() {
	const names: string[] = [];
	const step = {
		run: async <T>(config: { name: string }, fn: () => Promise<T> | T): Promise<T> => {
			names.push(config.name);
			return fn();
		}
	};
	return { step, names };
}

function makeMailer() {
	const send = vi.fn();
	const mailer: Mailer = { send };
	return { mailer, send };
}

const brokeInput: SendOwnerAlertInput = {
	calendarId: 'work',
	kind: 'broke',
	since: '2026-05-01T10:00:00Z',
	reason: 'No successful refresh in over an hour.'
};

async function bootDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

describe('runSendOwnerAlert', () => {
	test('sends the alert to the configured owner', async () => {
		const db = await bootDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: true });
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger(), mailer });

		const { step, names } = makeStep();
		const result = await runSendOwnerAlert(brokeInput, step);

		expect(result).toBe('sent');
		expect(names).toEqual(['smtp:owner@acme.test']);
		expect(send.mock.calls[0][0].to).toBe('owner@acme.test');
		await db.destroy();
	});

	test('returns failed when the send keeps failing', async () => {
		const db = await bootDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: false, reason: 'smtp down' });
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger(), mailer });

		const { step } = makeStep();
		expect(await runSendOwnerAlert(brokeInput, step)).toBe('failed');
		await db.destroy();
	});

	test('skips without attempting when SMTP is unconfigured', async () => {
		const db = await bootDb();
		const { mailer, send } = makeMailer();
		setWorkerContext({
			config: { ...sampleInput.cfg, smtp: undefined },
			db,
			logger: createLogger(),
			mailer
		});

		const { step } = makeStep();
		expect(await runSendOwnerAlert(brokeInput, step)).toBe('skipped');
		expect(send).not.toHaveBeenCalled();
		await db.destroy();
	});
});
