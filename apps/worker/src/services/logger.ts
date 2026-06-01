export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

/** Write one structured JSON log line to stdout. */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
	const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
	process.stdout.write(line + '\n');
}

export function createLogger(): Logger {
	return {
		debug: (message, fields) => log('debug', message, fields),
		info: (message, fields) => log('info', message, fields),
		warn: (message, fields) => log('warn', message, fields),
		error: (message, fields) => log('error', message, fields)
	};
}
