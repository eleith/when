import type { WhenConfiguration } from '@when/config';
import type { SendOwnerAlertInput } from '@when/jobs';
import { deriveBrand } from '../format.js';
import type { Attachment, EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';

// An owner-only alert (no attendee, no appointment), addressed straight to the
// configured owner. `broke` explains the consequence; `recovered` is the all-clear.
// Pure builder: the handler fetches the logo and renders via renderMessage.
export function ownerAlert(
	cfg: WhenConfiguration,
	input: SendOwnerAlertInput,
	logo: Attachment | null
): EmailMessage {
	const brand = deriveBrand(cfg, logo?.cid);
	const broke = input.kind === 'broke';

	const content: EmailContent = {
		brand,
		subject: broke
			? `Calendar sync problem: ${input.calendarId}`
			: `Calendar sync recovered: ${input.calendarId}`,
		heading: broke
			? `Calendar "${input.calendarId}" stopped syncing.`
			: `Calendar "${input.calendarId}" is syncing again.`,
		paragraphs: broke
			? [
					input.reason,
					"Bookings still work and you're still emailed — but this calendar won't reflect them until it recovers."
				]
			: [input.reason, "It's back in sync; nothing more to do."],
		rows: [
			{ label: 'Calendar', value: input.calendarId },
			{ label: 'Since', value: input.since }
		],
		actions: [],
		previewText: broke
			? `Reason: ${input.reason}`
			: 'Sync is working again.'
	};

	return { to: cfg.user.email, content };
}
