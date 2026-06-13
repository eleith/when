import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import type { SendOwnerAlertInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleInput } from '../email/__fixtures__/booking.js';

vi.mock('../email/smtp.js', () => ({ sendEmail: vi.fn() }));
import { sendEmail } from '../email/smtp.js';
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

const brokeInput: SendOwnerAlertInput = {
	calendarId: 'work',
	kind: 'broke',
	since: '2026-05-01T10:00:00Z',
	reason: 'No successful refresh in over an hour.'
};

async function bootCtx() {
	const db = openDb(':memory:');
	await runMigrations(db);
	setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger() });
	return db;
}

describe('runSendOwnerAlert', () => {
	beforeEach(() => vi.mocked(sendEmail).mockReset());

	test('sends the alert to the configured owner', async () => {
		const db = await bootCtx();
		vi.mocked(sendEmail).mockResolvedValue({ ok: true });

		const { step, names } = makeStep();
		const result = await runSendOwnerAlert(brokeInput, step);

		expect(result).toBe('sent');
		expect(names).toEqual(['smtp:owner@acme.test']);
		expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe('owner@acme.test');
		await db.destroy();
	});

	test('returns failed when the send keeps failing', async () => {
		const db = await bootCtx();
		vi.mocked(sendEmail).mockResolvedValue({ ok: false, reason: 'smtp down' });

		const { step } = makeStep();
		expect(await runSendOwnerAlert(brokeInput, step)).toBe('failed');
		await db.destroy();
	});

	test('skips without attempting when SMTP is unconfigured', async () => {
		const db = openDb(':memory:');
		await runMigrations(db);
		setWorkerContext({
			config: { ...sampleInput.cfg, smtp: undefined },
			db,
			logger: createLogger()
		});

		const { step } = makeStep();
		expect(await runSendOwnerAlert(brokeInput, step)).toBe('skipped');
		expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
		await db.destroy();
	});
});
