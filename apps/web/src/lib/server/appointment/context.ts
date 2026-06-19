import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { systemClock, type Clock } from '../clock';
import { getConfig, getDb } from '../state';

/** The shared context every appointment action runs against: live db, config, clock. */
export interface AppointmentContext {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export function appointmentContext(): AppointmentContext {
	return { db: getDb(), cfg: getConfig(), clock: systemClock };
}
