import { buildLink as buildGoogleLink } from './google';
import { buildLink as buildOutlookLink } from './outlook';
import type { CalendarLinkInput } from './types';

export type { BuildLink, CalendarLinkInput } from './types';

export interface AddToCalendarLinks {
	google: string;
	outlook: string;
	ics: string;
}

export function buildAddToCalendarLinks(
	input: CalendarLinkInput,
	icsUrl: string
): AddToCalendarLinks {
	return {
		google: buildGoogleLink(input),
		outlook: buildOutlookLink(input),
		ics: icsUrl
	};
}
