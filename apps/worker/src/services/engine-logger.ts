import type { Logger as EngineLogger } from 'openworkflow';
import type { Logger as PinoLogger } from './logger.js';

const operationalMessages = [
	['Worker tick failed:', 'Workflow engine worker poll failed'],
	['Worker schedule tick failed:', 'Workflow engine schedule poll failed'],
	['Heartbeat failed:', 'Workflow engine heartbeat failed'],
	['Critical error during workflow execution for run ', 'Workflow engine execution failed']
] as const;

function safeMessage(message: string, level: 'debug' | 'info' | 'warn' | 'error'): string {
	if (typeof message === 'string') {
		for (const [prefix, fixedMessage] of operationalMessages) {
			if (message.startsWith(prefix)) return fixedMessage;
		}
	}
	return `Workflow engine ${level}`;
}

/** Keep operational categories, never engine text or arguments that may contain secrets. */
export function createEngineLogger(log: PinoLogger): EngineLogger {
	return {
		debug: (message) => log.debug(safeMessage(message, 'debug')),
		info: (message) => log.info(safeMessage(message, 'info')),
		warn: (message) => log.warn(safeMessage(message, 'warn')),
		error: (message) => log.error(safeMessage(message, 'error'))
	};
}
