import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { createEngineLogger } from './engine-logger.js';

function captureLogs() {
	let output = '';
	const log = pino(
		{ level: 'debug', base: null, timestamp: false },
		{
			write(chunk: string) {
				output += chunk;
			}
		}
	);
	return {
		engine: createEngineLogger(log),
		output: () => output,
		entries: () =>
			output
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
	};
}

const secret = 'SECRET_CREDENTIAL_SENTINEL';
const capabilityUrl = 'https://example.test/appointment?token=CAPABILITY_SENTINEL';
const unsafeError = new Error(`${secret} ${capabilityUrl}`, {
	cause: new Error(`nested cause ${secret}`)
});
unsafeError.name = secret;
unsafeError.stack = `unsafe stack ${capabilityUrl}`;
const unsafeArgs = [
	secret,
	capabilityUrl,
	unsafeError,
	{ nested: { password: secret, envelope: { html: capabilityUrl }, error: unsafeError } }
];

function expectNoSecrets(output: string) {
	expect(output).not.toContain(secret);
	expect(output).not.toContain('CAPABILITY_SENTINEL');
}

describe('createEngineLogger', () => {
	test.each([
		['Worker tick failed:', 'Workflow engine worker poll failed'],
		['Worker schedule tick failed:', 'Workflow engine schedule poll failed'],
		['Heartbeat failed:', 'Workflow engine heartbeat failed'],
		[
			'Critical error during workflow execution for run 936e818f-c6ab-4a1d-8af6-19d349482b50:',
			'Workflow engine execution failed'
		]
	])('classifies %s without forwarding any input', (message, expected) => {
		const logs = captureLogs();
		logs.engine.error(`${message} ${secret} ${capabilityUrl}`, ...unsafeArgs);
		expect(logs.entries()).toEqual([{ level: 50, msg: expected }]);
		expectNoSecrets(logs.output());
	});

	test.each([
		['debug', 20],
		['info', 30],
		['warn', 40],
		['error', 50]
	] as const)('maps unknown %s output to fixed text at the same level', (method, level) => {
		const logs = captureLogs();
		logs.engine[method](`unrecognized ${secret} ${capabilityUrl}`, ...unsafeArgs);
		expect(logs.entries()).toEqual([{ level, msg: `Workflow engine ${method}` }]);
		expectNoSecrets(logs.output());
	});

	test('does not inspect or serialize unexpected message objects or arguments', () => {
		const logs = captureLogs();
		const hostile = {
			toString() {
				throw new Error('must not stringify');
			},
			toJSON() {
				throw new Error('must not serialize');
			}
		};
		Reflect.apply(logs.engine.info, logs.engine, [hostile, ...unsafeArgs]);
		logs.engine.warn('Heartbeat failed:', hostile, ...unsafeArgs);
		expect(logs.entries()).toEqual([
			{ level: 30, msg: 'Workflow engine info' },
			{ level: 40, msg: 'Workflow engine heartbeat failed' }
		]);
		expectNoSecrets(logs.output());
	});
});
