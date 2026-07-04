import type { WhenConfiguration } from './schema.js';
import type { ConfigIssue } from './load.js';

export function checkCrossRefs(cfg: WhenConfiguration): ConfigIssue[] {
	const issues: ConfigIssue[] = [];
	const serviceIds = new Set<string>();

	(cfg.services ?? []).forEach((srv, i) => {
		if (serviceIds.has(srv.id)) {
			issues.push({
				path: `/services/${i}/id`,
				message: `duplicate service id "${srv.id}"`
			});
		}
		serviceIds.add(srv.id);
	});

	const videoChatIds = new Set<string>();
	(cfg.video_chats ?? []).forEach((vc, i) => {
		if (videoChatIds.has(vc.id)) {
			issues.push({
				path: `/video_chats/${i}/id`,
				message: `duplicate video_chat id "${vc.id}"`
			});
		}
		videoChatIds.add(vc.id);

		if (!serviceIds.has(vc.service_id)) {
			issues.push({
				path: `/video_chats/${i}/service_id`,
				message: `references unknown service id "${vc.service_id}"`
			});
		}
	});

	const calendarIds = new Set<string>();
	const calendarTypes = new Map<string, string>();

	cfg.calendars.forEach((cal, i) => {
		if (calendarIds.has(cal.id)) {
			issues.push({
				path: `/calendars/${i}/id`,
				message: `duplicate calendar id "${cal.id}"`
			});
		}
		calendarIds.add(cal.id);
		calendarTypes.set(cal.id, cal.type);

		if (!serviceIds.has(cal.service_id)) {
			issues.push({
				path: `/calendars/${i}/service_id`,
				message: `references unknown service id "${cal.service_id}"`
			});
		}
	});

	const seenEventIds = new Set<string>();
	const seenSlugs = new Set<string>();

	cfg.event_types.forEach((et, i) => {
		if (seenEventIds.has(et.id)) {
			issues.push({
				path: `/event_types/${i}/id`,
				message: `duplicate event_type id "${et.id}"`
			});
		}
		seenEventIds.add(et.id);

		if (seenSlugs.has(et.slug)) {
			issues.push({
				path: `/event_types/${i}/slug`,
				message: `duplicate event_type slug "${et.slug}"`
			});
		}
		seenSlugs.add(et.slug);

		if (!calendarIds.has(et.destination_calendar)) {
			issues.push({
				path: `/event_types/${i}/destination_calendar`,
				message: `references unknown calendar id "${et.destination_calendar}"`
			});
		}

		(et.conflict_calendars ?? []).forEach((cid, j) => {
			if (!calendarIds.has(cid)) {
				issues.push({
					path: `/event_types/${i}/conflict_calendars/${j}`,
					message: `references unknown calendar id "${cid}"`
				});
			}
		});

		if (et.video_chat) {
			const isUrl = (() => {
				try {
					new URL(et.video_chat!);
					return true;
				} catch {
					return false;
				}
			})();

			if (!isUrl) {
				if (!videoChatIds.has(et.video_chat)) {
					issues.push({
						path: `/event_types/${i}/video_chat`,
						message: `references unknown video_chat id or invalid URL "${et.video_chat}"`
					});
				} else {
					const vc = (cfg.video_chats ?? []).find((v) => v.id === et.video_chat);
					if (vc && vc.type === 'google-meet') {
						const destCalType = calendarTypes.get(et.destination_calendar);
						if (destCalType && destCalType !== 'google') {
							issues.push({
								path: `/event_types/${i}/video_chat`,
								message: `Google Meet dynamic video chat is only supported when the destination calendar is a Google Calendar (calendar "${et.destination_calendar}" is of type "${destCalType}")`
							});
						}
					}
				}
			}
		}

		checkFormFields(et, i, issues);
	});

	return issues;
}

const MAX_FORM_FIELDS = 10;

function checkFormFields(
	et: WhenConfiguration['event_types'][number],
	i: number,
	issues: ConfigIssue[]
): void {
	const fields = et.form_fields;
	if (!fields) return;

	const base = `/event_types/${i}/form_fields`;

	if (fields.length === 0) {
		issues.push({ path: base, message: 'form_fields must have at least one field' });
		return;
	}

	if (fields.length > MAX_FORM_FIELDS) {
		issues.push({
			path: base,
			message: `form has ${fields.length} fields, exceeds the max of ${MAX_FORM_FIELDS}`
		});
	}

	const seenIds = new Set<string>();
	const typeCounts = new Map<string, number>();

	fields.forEach((field, j) => {
		if (seenIds.has(field.id)) {
			issues.push({ path: `${base}/${j}/id`, message: `duplicate form field id "${field.id}"` });
		}
		seenIds.add(field.id);
		typeCounts.set(field.type, (typeCounts.get(field.type) ?? 0) + 1);

		if (field.type === 'choice' && (field.choices?.length ?? 0) === 0) {
			issues.push({
				path: `${base}/${j}/choices`,
				message: `choice field "${field.id}" must have a non-empty choices list`
			});
		}
	});

	const nameFields = fields.filter((f) => f.type === 'guest_name');
	if (nameFields.length === 0) {
		issues.push({ path: base, message: 'form must include a guest_name field' });
	} else if (nameFields.length > 1) {
		issues.push({ path: base, message: 'guest_name must appear exactly once' });
	} else if (!nameFields[0].required) {
		const at = fields.indexOf(nameFields[0]);
		issues.push({ path: `${base}/${at}/required`, message: 'guest_name must be required' });
	}

	for (const type of ['guest_email', 'event_location'] as const) {
		if ((typeCounts.get(type) ?? 0) > 1) {
			issues.push({ path: base, message: `${type} may appear at most once` });
		}
	}
}
