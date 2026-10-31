import { appointmentOperationsTotal } from './registry';

type AppointmentAction = 'create' | 'accept' | 'decline' | 'cancel' | 'reschedule';
type AppointmentActor = 'host' | 'guest';

export function observeAppointmentOperation<Args extends unknown[], Result extends { ok: boolean }>(
	action: AppointmentAction,
	operation: (...args: Args) => Promise<Result>,
	actor: (...args: Args) => AppointmentActor
): (...args: Args) => Promise<Result> {
	return async (...args) => {
		const initiator = actor(...args);
		let result: Result;
		try {
			result = await operation(...args);
		} catch (err) {
			appointmentOperationsTotal.inc({ action, actor: initiator, status: 'error' });
			throw err;
		}
		const status = result.ok ? 'success' : 'rejected';
		appointmentOperationsTotal.inc({ action, actor: initiator, status });
		return result;
	};
}
