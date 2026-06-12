import { systemClock } from '../clock';
import { getConfig, getDb } from '../state';

/** The deps every booking action takes: the live db, config, and clock. */
export function bookingDeps() {
	return { db: getDb(), cfg: getConfig(), clock: systemClock };
}
