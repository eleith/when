import { expireStalePending } from '@when/db';
import { observeExpiry } from '../metrics/appointments.js';

export const expirePending = observeExpiry(expireStalePending);
