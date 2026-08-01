import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { getCalendarAdapter } from '@when/calendar';
import { calendarCommand } from './index.ts';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';

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
providers:
  - name: "dav"
    type: "caldav"
    url: "https://dav.example.com/"
    username: "u"
    password: "p"
  - name: "dav-envref"
    type: "caldav"
    url: "https://dav.example.com/"
    username: "u"
    password: "\${WHEN_CAL_SECRET}"
calendars:
  - name: "work"
    type: "caldav"
    provider: "dav"
    url: "https://dav.example.com/calendars/u/work/"
  - name: "envref"
    type: "caldav"
    provider: "dav-envref"
    url: "https://dav.example.com/calendars/u/envref/"
schedules:
  - name: "standard"
    weekly:
      - days: [mon]
        from: "09:00"
        to: "17:00"
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

const path = join(process.cwd(), 'temp-calendar-config.yaml');

function ctx(values: Record<string, unknown>) {
	return { values } as unknown as Parameters<NonNullable<typeof testCommand.run>>[0];
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

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(getCalendarAdapter).mockReset();
		process.env.WHEN_CAL_SECRET = 'set';
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

	test('bare calendar prints usage', () => {
		calendarCommand.run!();
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli calendar list'));
	});

	test('list shows configured calendars', async () => {
		await listCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('work  (caldav)');
		expect(logSpy).toHaveBeenCalledWith('envref  (caldav)');
	});

	test('test reports the busy interval count', async () => {
		mockFetchBusy(async () => [{}, {}, {}]);
		await testCommand.run!(ctx({ name: 'work', config: path }));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('✅ work (caldav) — 3 busy interval')
		);
	});

	test('test fails when the adapter throws', async () => {
		mockFetchBusy(async () => {
			throw new Error('REPORT failed: 500');
		});
		await testCommand.run!(ctx({ name: 'work', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ work (caldav)'));
	});

	test('test requires a calendar name', async () => {
		await testCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a calendar name'));
	});

	test('unknown calendar name fails', async () => {
		await testCommand.run!(ctx({ name: 'nope', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no calendar named "nope"'));
	});

	test('an unset env var anywhere in the config is named, before any calendar work', async () => {
		delete process.env.WHEN_CAL_SECRET;
		await testCommand.run!(ctx({ name: 'work', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WHEN_CAL_SECRET'));
		expect(getCalendarAdapter).not.toHaveBeenCalled();
	});
});
