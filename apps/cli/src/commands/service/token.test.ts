import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { text, isCancel } from '@clack/prompts';
import { getGoogleAccessToken } from '@when/calendar';
import { exchangeCodeForTokens } from '../../services/google.ts';
import { runServiceToken } from './token.ts';
import type { Service } from '@when/config';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false)
}));
vi.mock('@when/calendar', () => ({ getGoogleAccessToken: vi.fn() }));
vi.mock('../../services/google.ts', () => ({
	buildGoogleAuthUrl: vi.fn(() => 'https://auth.example'),
	extractAuthCode: vi.fn((v: string) => v),
	exchangeCodeForTokens: vi.fn()
}));

function googleSvc(name: string, secret: string, tokenRef: string): Service {
	return {
		name,
		type: 'google',
		client_id: 'cid',
		client_secret: secret,
		refresh_token: tokenRef
	} as Service;
}

const caldavSvc: Service = {
	name: 'dav',
	type: 'caldav',
	url: 'https://dav.example.com/',
	username: 'u',
	password: 'p'
} as Service;

const gg = googleSvc('gg', 'csecret', '${WHEN_SVC_GG_TOKEN}');
const services: Service[] = [gg, caldavSvc, googleSvc('gg-badenv', '${WHEN_SVC_UNSET}', 'x')];

describe('service token action', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(text).mockReset().mockResolvedValue('CODE');
		vi.mocked(isCancel).mockReset().mockReturnValue(false);
		vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
		vi.mocked(exchangeCodeForTokens).mockReset();
		delete process.env.WHEN_SVC_UNSET;
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
	});

	test('rejects a non-google service', async () => {
		await runServiceToken(services, 'dav', false);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('token is only for google'));
		expect(exchangeCodeForTokens).not.toHaveBeenCalled();
	});

	test('rejects an unknown service name', async () => {
		await runServiceToken(services, 'nope', false);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no service named "nope"'));
	});

	test('fails when the client_secret env var is unset', async () => {
		await runServiceToken(services, 'gg-badenv', false);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WHEN_SVC_UNSET'));
		expect(exchangeCodeForTokens).not.toHaveBeenCalled();
	});

	test('mints and prints the env var assignment on success', async () => {
		vi.mocked(exchangeCodeForTokens).mockResolvedValue({
			access_token: 'a',
			refresh_token: 'RT',
			expires_in: 3600
		});
		await runServiceToken(services, 'gg', false);
		expect(process.exitCode).toBeUndefined();
		expect(exchangeCodeForTokens).toHaveBeenCalledWith(
			'cid',
			'csecret',
			'CODE',
			'http://localhost'
		);
		expect(getGoogleAccessToken).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith('WHEN_SVC_GG_TOKEN="RT"');
	});

	test('quiet prints only the raw token', async () => {
		vi.mocked(exchangeCodeForTokens).mockResolvedValue({
			access_token: 'a',
			refresh_token: 'RT',
			expires_in: 3600
		});
		await runServiceToken(services, 'gg', true);
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('RT');
		expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('✅'));
	});

	test('fails when Google returns no refresh token', async () => {
		vi.mocked(exchangeCodeForTokens).mockResolvedValue({
			access_token: 'a',
			refresh_token: '',
			expires_in: 3600
		});
		await runServiceToken(services, 'gg', false);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no refresh token'));
		expect(getGoogleAccessToken).not.toHaveBeenCalled();
	});

	test('fails when the token exchange throws', async () => {
		vi.mocked(exchangeCodeForTokens).mockRejectedValue(new Error('bad code'));
		await runServiceToken(services, 'gg', false);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('token exchange failed'));
	});

	test('cancelling the prompt aborts without minting', async () => {
		vi.mocked(isCancel).mockReturnValue(true);
		await runServiceToken(services, 'gg', false);
		expect(process.exitCode).toBeUndefined();
		expect(exchangeCodeForTokens).not.toHaveBeenCalled();
	});
});
