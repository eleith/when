import type { BuildLink } from './types';

/** Convert an ISO instant to Google's `YYYYMMDDTHHMMSSZ` compact UTC form. */
function formatGoogleDate(iso: string): string {
	return iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

export const buildLink: BuildLink = (input) => {
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: input.title,
		dates: `${formatGoogleDate(input.start)}/${formatGoogleDate(input.end)}`
	});
	if (input.description) params.set('details', input.description);
	if (input.location) params.set('location', input.location);
	return `https://calendar.google.com/calendar/render?${params.toString()}`;
};
