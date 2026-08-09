import pino, { type Logger, type LoggerOptions } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const loggerOptions: LoggerOptions = {
	level: process.env.WHEN_LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
	base: { app: 'when' },
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
			'*.cancel_token',
			// A wildcard spans one level, so a provider's secrets sit a level deeper
			// than these: they live under providers.<name>, keyed by the operator.
			'*.*.password',
			'*.*.client_secret',
			'*.*.refresh_token'
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
