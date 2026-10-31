import type { expireStalePending } from '@when/db';
import { appointmentOperationsTotal } from './registry.js';

export function observeExpiry(operation: typeof expireStalePending): typeof expireStalePending {
	return async (...args) => {
		let count: number;
		try {
			count = await operation(...args);
		} catch (error) {
			appointmentOperationsTotal.inc({ action: 'expire', actor: 'system', status: 'error' });
			throw error;
		}
		appointmentOperationsTotal.inc({ action: 'expire', actor: 'system', status: 'success' });
		return count;
	};
}
