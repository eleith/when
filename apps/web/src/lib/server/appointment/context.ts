import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { systemClock, type Clock } from '../clock';
import { getConfig, getDb } from '../state';

/** The shared context every booking action runs against: live db, config, clock. */
export interface BookingContext {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export function bookingContext(): BookingContext {
	return { db: getDb(), cfg: getConfig(), clock: systemClock };
}
