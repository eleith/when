import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { getCalendarAdapter } from '@when/calendar';
import { calendarCommand } from './index.ts';

vi.mock('@when/calendar', () => ({ getCalendarAdapter: vi.fn() }));

const configYaml = `
auth:
  credentials:
    username: "admin"
    password: "pw"
user:
  name: "Jane Doe"
  email: "jane@example.com"
  timezone: "America/New_York"
smtp:
  host: "smtp.example.com"
  port: 587
  user: "smtp_user"
  pass: "smtp_pass"
services:
  - name: "dav"
    type: "caldav"
    url: "https://dav.example.com/"
    username: "u"
    password: "p"
  - name: "dav-badenv"
    type: "caldav"
    url: "https://dav.example.com/"
    username: "u"
    password: "\${WHEN_CAL_UNSET}"
calendars:
  - name: "work"
    type: "caldav"
    service: "dav"
    url: "https://dav.example.com/calendars/u/work/"
  - name: "broken"
    type: "caldav"
    service: "dav-badenv"
    url: "https://dav.example.com/calendars/u/broken/"
schedules:
  - name: "standard"
    weekly:
      monday: ["09:00-17:00"]
meetings:
  - name: "chat"
    duration_minutes: 30
    slug: "chat"
    booking_approval: "instant"
    booking_calendar: "work"
    schedule: "standard"
database:
  app: "./data/when.sqlite"
  queue: "./data/openworkflow.sqlite"
url:
  app: "https://book.example.com"
`;

type RunCtx = Parameters<NonNullable<typeof calendarCommand.run>>[0];

function ctxFor(positionals: string[], config?: string): RunCtx {
	return {
		values: config ? { config } : {},
		positionals: ['calendar', ...positionals],
		commandPath: ['calendar']
	} as unknown as RunCtx;
}

function mockFetchBusy(impl: () => Promise<unknown[]>) {
	vi.mocked(getCalendarAdapter).mockReturnValue({
		fetchBusy: vi.fn(impl)
	} as unknown as ReturnType<typeof getCalendarAdapter>);
}

describe('calendar command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;
	const path = join(process.cwd(), 'temp-calendar-config.yaml');

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(getCalendarAdapter).mockReset();
		delete process.env.WHEN_CAL_UNSET;
		writeFileSync(path, configYaml);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
		try {
			unlinkSync(path);
		} catch {
			/* ignore */
		}
	});

	test('bare calendar prints usage', async () => {
		await calendarCommand.run!(ctxFor([]));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli calendar list'));
	});

	test('list shows configured calendars', async () => {
		await calendarCommand.run!(ctxFor(['list'], path));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('work  (caldav)');
		expect(logSpy).toHaveBeenCalledWith('broken  (caldav)');
	});

	test('test reports the busy interval count', async () => {
		mockFetchBusy(async () => [{}, {}, {}]);
		await calendarCommand.run!(ctxFor(['work', 'test'], path));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('✅ work (caldav) — 3 busy interval')
		);
	});

	test('test fails when the adapter throws', async () => {
		mockFetchBusy(async () => {
			throw new Error('REPORT failed: 500');
		});
		await calendarCommand.run!(ctxFor(['work', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ work (caldav)'));
	});

	test('unknown calendar name fails', async () => {
		await calendarCommand.run!(ctxFor(['nope', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no calendar named "nope"'));
	});

	test('unknown action fails', async () => {
		await calendarCommand.run!(ctxFor(['work', 'frob'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unknown action "frob"'));
	});

	test('unset service env var is named, not resolved', async () => {
		await calendarCommand.run!(ctxFor(['broken', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WHEN_CAL_UNSET'));
		expect(getCalendarAdapter).not.toHaveBeenCalled();
	});
});
