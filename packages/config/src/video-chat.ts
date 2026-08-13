import type { GuestAnswer } from './form-fields.js';
import type { Meeting, WhenConfiguration } from './schema.js';

/**
 * Determines whether a meeting is configured to attach video chat automatically
 * at booking time based on `meeting.video_chat.attach` and the guest's answers.
 */
export function shouldAttachVideoChat(
	meeting: Meeting,
	config: WhenConfiguration,
	answers: readonly GuestAnswer[] = []
): boolean {
	if (!meeting.video_chat) {
		return false;
	}

	const service = config.providers[meeting.video_chat.provider];
	if (!service) {
		return false;
	}

	const attach = meeting.video_chat.attach;
	if (attach && 'auto' in attach && !attach.auto) {
		return false;
	}

	if (attach && 'when' in attach && attach.when) {
		const answerMap = new Map(answers.map((a) => [a.name, a.value]));
		const matches = attach.when.every((cond) => {
			const val = answerMap.get(cond.field) ?? '';
			if (!val) return false;
			if (cond.equals === undefined) return true;
			const accepted = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
			return accepted.includes(val);
		});
		if (!matches) {
			return false;
		}
	}

	return true;
}
