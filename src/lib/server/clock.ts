export interface Clock {
	now(): Date;
	nowMs(): number;
}

export const systemClock: Clock = {
	now: () => new Date(),
	nowMs: () => Date.now()
};
