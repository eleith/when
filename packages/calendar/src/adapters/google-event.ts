import { getGoogleAccessToken, type GoogleConfig } from './google.js';

function googleEventUrl(cfg: GoogleConfig, eventId: string): string {
	const calendar = encodeURIComponent(cfg.google_calendar_id);
	return `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(eventId)}`;
}

async function readGoogleEventResponse(res: Response, allowEmpty: boolean): Promise<unknown> {
	if (!res.ok) throw new Error(`Google event HTTP error: ${res.status}`);
	if (allowEmpty && res.status === 204) return undefined;
	let body: string;
	try {
		body = await res.text();
	} catch {
		throw new Error('Google event response read failed');
	}
	try {
		const data: unknown = JSON.parse(body);
		return data;
	} catch {
		throw new Error('Google event response is not valid JSON');
	}
}

export async function getGoogleEvent(cfg: GoogleConfig, eventId: string): Promise<unknown> {
	const url = googleEventUrl(cfg, eventId);
	let res: Response;
	try {
		const token = await getGoogleAccessToken(cfg);
		res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	} catch {
		throw new Error('Google event GET request failed');
	}
	const data = await readGoogleEventResponse(res, false);
	return data;
}

export async function patchGoogleEvent(
	cfg: GoogleConfig,
	eventId: string,
	fields: Record<string, unknown>,
	query: Record<string, string>
): Promise<unknown> {
	const url = new URL(googleEventUrl(cfg, eventId));
	url.search = new URLSearchParams(query).toString();
	let res: Response;
	try {
		const token = await getGoogleAccessToken(cfg);
		res = await fetch(url.toString(), {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(fields)
		});
	} catch {
		throw new Error('Google event PATCH request failed');
	}
	const data = await readGoogleEventResponse(res, true);
	return data;
}
