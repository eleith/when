import type { BuildLink } from './types';

export const buildLink: BuildLink = (input) => {
	const params = new URLSearchParams({
		path: '/calendar/action/compose',
		rru: 'addevent',
		subject: input.title,
		startdt: input.start,
		enddt: input.end
	});
	if (input.description) params.set('body', input.description);
	if (input.location) params.set('location', input.location);
	return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};
