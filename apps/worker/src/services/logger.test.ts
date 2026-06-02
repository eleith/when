import { afterEach, expect, test, vi } from 'vitest';
import { createLogger, log } from './logger.js';

afterEach(() => vi.restoreAllMocks());

function captureStdout(): () => string[] {
	const lines: string[] = [];
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		lines.push(String(chunk));
		return true;
	});
	return () => lines;
}

test('log writes a single structured JSON line', () => {
	const lines = captureStdout();
	log('info', 'hello', { a: 1 });
	expect(lines()).toHaveLength(1);
	const parsed = JSON.parse(lines()[0]);
	expect(parsed).toMatchObject({ level: 'info', message: 'hello', a: 1 });
	expect(typeof parsed.ts).toBe('string');
	expect(lines()[0].endsWith('\n')).toBe(true);
});

test('createLogger routes each level through log', () => {
	const lines = captureStdout();
	const logger = createLogger();
	logger.warn('careful');
	logger.error('boom', { code: 500 });
	const levels = lines().map((l) => JSON.parse(l).level);
	expect(levels).toEqual(['warn', 'error']);
	expect(JSON.parse(lines()[1])).toMatchObject({ message: 'boom', code: 500 });
});
