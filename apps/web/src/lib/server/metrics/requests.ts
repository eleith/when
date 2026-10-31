import { bookingAttemptsTotal, icsDownloadsTotal } from './registry';

type BookingOutcome = 'success' | 'invalid_input' | 'slot_taken' | 'error';
type IcsOutcome = 'success' | 'not_found' | 'forbidden' | 'error';

export function recordBookingOutcome(eventTypeId: string, status: BookingOutcome): void {
	bookingAttemptsTotal.inc({ event_type_id: eventTypeId, status });
}

export function recordIcsDownload(status: IcsOutcome): void {
	icsDownloadsTotal.inc({ status });
}
