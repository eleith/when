export interface Clock {
	now(): Date;
	nowMs(): number;
}

export const systemClock: Clock = {
	now: () => new Date(),
	nowMs: () => Date.now()
};

export function fixedClock(instant: Date | number | string): Clock {
	const ms =
		typeof instant === 'number'
			? instant
			: instant instanceof Date
				? instant.getTime()
				: new Date(instant).getTime();
	if (Number.isNaN(ms)) {
		throw new Error(`fixedClock: invalid instant ${String(instant)}`);
	}
	return {
		now: () => new Date(ms),
		nowMs: () => ms
	};
}
