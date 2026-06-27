import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type Logger = PinoLogger;

const isDev = process.env.NODE_ENV !== 'production';

export const loggerOptions: LoggerOptions = {
	level: process.env.WHEN_LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
	base: { app: 'when-worker' },
	redact: {
		paths: [
			'password',
			'password_hash',
			'client_secret',
			'access_token',
			'refresh_token',
			'cancel_token',
			'authorization',
			'cookie',
			'*.password',
			'*.password_hash',
			'*.client_secret',
			'*.access_token',
			'*.refresh_token',
			'*.cancel_token'
		],
		censor: '[REDACTED]'
	},
	...(isDev
		? {
				transport: {
					target: 'pino-pretty',
					options: { colorize: true, translateTime: 'HH:MM:ss.l', singleLine: false }
				}
			}
		: {})
};

export const logger: Logger = pino(loggerOptions);

export function createLogger(): Logger {
	return logger;
}
