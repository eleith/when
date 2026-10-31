import { createAppointment as create } from './appointment/create';
import { acceptAppointment as accept } from './appointment/accept';
import { declineAppointment as decline } from './appointment/decline';
import { cancelAppointment as cancel } from './appointment/cancel';
import { rescheduleAppointment as reschedule } from './appointment/reschedule';
import { observeAppointmentOperation } from './metrics/appointments';

export const createAppointment = observeAppointmentOperation(
	'create',
	create,
	(_ctx, input) => input.initiator ?? 'guest'
);
export const acceptAppointment = observeAppointmentOperation('accept', accept, () => 'host');
export const declineAppointment = observeAppointmentOperation('decline', decline, () => 'host');
export const cancelAppointment = observeAppointmentOperation(
	'cancel',
	cancel,
	(_ctx, input) => input.initiator
);
export const rescheduleAppointment = observeAppointmentOperation(
	'reschedule',
	reschedule,
	(_ctx, input) => input.initiator
);
