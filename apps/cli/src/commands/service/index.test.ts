import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { getGoogleAccessToken } from '@when/calendar';
import { serviceCommand } from './index.ts';

vi.mock('@when/calendar', () => ({ getGoogleAccessToken: vi.fn() }));

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
  - name: "gcal"
    type: "google"
    client_id: "cid"
    client_secret: "csecret"
    refresh_token: "rtok"
  - name: "dav"
    type: "caldav"
    url: "https://dav.example.com/remote.php/dav/"
    username: "u"
    password: "p"
  - name: "gcal-badenv"
    type: "google"
    client_id: "cid2"
    client_secret: "\${WHEN_TEST_SVC_UNSET}"
    refresh_token: "rtok2"
calendars:
  - name: "work"
    type: "caldav"
    service: "dav"
    url: "https://dav.example.com/remote.php/dav/calendars/u/work/"
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

type RunCtx = Parameters<NonNullable<typeof serviceCommand.run>>[0];

function ctxFor(positionals: string[], config?: string): RunCtx {
	return {
		values: config ? { config } : {},
		positionals: ['service', ...positionals],
		commandPath: ['service']
	} as unknown as RunCtx;
}

describe('service command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;
	const path = join(process.cwd(), 'temp-service-config.yaml');

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(getGoogleAccessToken).mockReset();
		delete process.env.WHEN_TEST_SVC_UNSET;
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

	test('bare service prints usage', async () => {
		await serviceCommand.run!(ctxFor([]));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli service list'));
	});

	test('list shows configured services with type', async () => {
		await serviceCommand.run!(ctxFor(['list'], path));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('gcal  (google)');
		expect(logSpy).toHaveBeenCalledWith('dav  (caldav)');
		expect(logSpy).toHaveBeenCalledWith('gcal-badenv  (google)');
	});

	test('google test authenticates via getGoogleAccessToken', async () => {
		vi.mocked(getGoogleAccessToken).mockResolvedValue('access');
		await serviceCommand.run!(ctxFor(['gcal', 'test'], path));
		expect(process.exitCode).toBeUndefined();
		expect(getGoogleAccessToken).toHaveBeenCalledWith(
			expect.objectContaining({ client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtok' })
		);
		expect(logSpy).toHaveBeenCalledWith('✅ gcal (google) — authenticated');
	});

	test('google test fails when the token refresh throws', async () => {
		vi.mocked(getGoogleAccessToken).mockRejectedValue(
			new Error('Google token refresh failed: 400')
		);
		await serviceCommand.run!(ctxFor(['gcal', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ gcal (google)'));
	});

	test('caldav test passes on a 207 PROPFIND', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 207 }));
		await serviceCommand.run!(ctxFor(['dav', 'test'], path));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('✅ dav (caldav) — authenticated');
	});

	test('caldav test reports bad credentials on 401', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
		await serviceCommand.run!(ctxFor(['dav', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad credentials (401)'));
	});

	test('unknown service name fails', async () => {
		await serviceCommand.run!(ctxFor(['nope', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no service named "nope"'));
	});

	test('unset env var is named, not resolved', async () => {
		await serviceCommand.run!(ctxFor(['gcal-badenv', 'test'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WHEN_TEST_SVC_UNSET'));
		expect(getGoogleAccessToken).not.toHaveBeenCalled();
	});

	test('unknown action fails', async () => {
		await serviceCommand.run!(ctxFor(['gcal', 'frobnicate'], path));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unknown action "frobnicate"'));
	});
});
