import type { WhenConfiguration } from '@when/config';
import type { SendOwnerAlertInput } from '@when/jobs';
import { deriveBrand } from '../format.js';
import { fetchBrandLogo } from '../logo.js';
import { toSpec } from '../render.js';
import type { Envelope } from '../recipients.js';
import type { EmailContent } from '../content.js';

// An owner-only alert (no attendee, no appointment), addressed straight to the
// configured owner. `broke` explains the consequence; `recovered` is the all-clear.
export async function ownerAlert(
	cfg: WhenConfiguration,
	input: SendOwnerAlertInput
): Promise<Envelope> {
	const logo = await fetchBrandLogo(cfg);
	const brand = deriveBrand(cfg, logo?.cid);
	const broke = input.kind === 'broke';

	const content: EmailContent = {
		brand,
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
		actions: []
	};

	const subject = broke
		? `Calendar sync problem: ${input.calendarId}`
		: `Calendar sync recovered: ${input.calendarId}`;
	const spec = toSpec(content, subject);
	return {
		to: cfg.user.email,
		subject: spec.subject,
		text: spec.text,
		html: spec.html,
		attachments: logo ? [logo] : undefined
	};
}
