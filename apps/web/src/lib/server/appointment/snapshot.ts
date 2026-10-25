export interface MeetingSummary {
	title: string;
	description: string | undefined;
}

export function readMeetingSnapshot(snapshot: string | null): MeetingSummary | null {
	if (!snapshot) return null;
	let value: unknown;
	try {
		value = JSON.parse(snapshot);
	} catch {
		return null;
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	if (!('title' in value) || typeof value.title !== 'string') return null;
	if (!value.title.trim()) return null;
	const description =
		'description' in value && typeof value.description === 'string' ? value.description : undefined;
	return { title: value.title, description };
}
