/**
 * Calendar I/O logs through an injected logger so the package stays free of any
 * app-specific logging setup. The host process (web today, the worker once it
 * owns calendar work) calls {@link setLogger} once at startup; until then logs
 * are dropped. The shape matches pino's `(obj, msg)` call style.
 */
export interface Logger {
	debug(obj: unknown, msg: string): void;
	warn(obj: unknown, msg: string): void;
	error(obj: unknown, msg: string): void;
}

const noop: Logger = {
	debug: () => {},
	warn: () => {},
	error: () => {}
};

let current: Logger = noop;

/** Install the host's logger. Call once during startup. */
export function setLogger(next: Logger): void {
	current = next;
}

/** The package-wide logger, delegating to whatever {@link setLogger} installed. */
export const logger: Logger = {
	debug: (obj, msg) => current.debug(obj, msg),
	warn: (obj, msg) => current.warn(obj, msg),
	error: (obj, msg) => current.error(obj, msg)
};
