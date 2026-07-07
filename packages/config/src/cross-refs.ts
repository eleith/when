import type { WhenConfiguration } from './schema.js';
import type { ConfigIssue } from './load.js';

export function checkCrossRefs(cfg: WhenConfiguration): ConfigIssue[] {
	const issues: ConfigIssue[] = [];
	const serviceNames = new Set<string>();

	(cfg.services ?? []).forEach((srv, i) => {
		if (serviceNames.has(srv.name)) {
			issues.push({
				path: `/services/${i}/name`,
				message: `duplicate service name "${srv.name}"`
			});
		}
		serviceNames.add(srv.name);
	});

	const calendarNames = new Set<string>();
	const calendarTypes = new Map<string, string>();

	cfg.calendars.forEach((cal, i) => {
		if (calendarNames.has(cal.name)) {
			issues.push({
				path: `/calendars/${i}/name`,
				message: `duplicate calendar name "${cal.name}"`
			});
		}
		calendarNames.add(cal.name);
		calendarTypes.set(cal.name, cal.type);

		if (!serviceNames.has(cal.service)) {
			issues.push({
				path: `/calendars/${i}/service`,
				message: `references unknown service "${cal.service}"`
			});
		}
	});

	const scheduleNames = new Set<string>();
	cfg.schedules.forEach((sch, i) => {
		if (scheduleNames.has(sch.name)) {
			issues.push({
				path: `/schedules/${i}/name`,
				message: `duplicate schedule name "${sch.name}"`
			});
		}
		scheduleNames.add(sch.name);
	});

	const seenMeetingNames = new Set<string>();
	const seenSlugs = new Set<string>();

	cfg.meetings.forEach((et, i) => {
		if (seenMeetingNames.has(et.name)) {
			issues.push({
				path: `/meetings/${i}/name`,
				message: `duplicate meeting name "${et.name}"`
			});
		}
		seenMeetingNames.add(et.name);

		if (seenSlugs.has(et.slug)) {
			issues.push({
				path: `/meetings/${i}/slug`,
				message: `duplicate meeting slug "${et.slug}"`
			});
		}
		seenSlugs.add(et.slug);

		if (!calendarNames.has(et.booking_calendar)) {
			issues.push({
				path: `/meetings/${i}/booking_calendar`,
				message: `references unknown calendar name "${et.booking_calendar}"`
			});
		}

		if (!scheduleNames.has(et.schedule)) {
			issues.push({
				path: `/meetings/${i}/schedule`,
				message: `references unknown schedule name "${et.schedule}"`
			});
		} else if (et.booking_style === 'select') {
			const start_times_every_minutes = et.start_times_every_minutes ?? et.duration_minutes;
			if (start_times_every_minutes < et.duration_minutes) {
				issues.push({
					path: `/meetings/${i}/start_times_every_minutes`,
					message: `in "select" booking style, start_times_every_minutes (${start_times_every_minutes}) must be greater than or equal to the meeting duration_minutes (${et.duration_minutes}) to prevent overlapping slot buttons`
				});
			}
		}

		(et.busy_calendars ?? []).forEach((cid, j) => {
			if (!calendarNames.has(cid)) {
				issues.push({
					path: `/meetings/${i}/busy_calendars/${j}`,
					message: `references unknown calendar name "${cid}"`
				});
			}
		});

		if (et.video_chat_service) {
			const srv = (cfg.services ?? []).find((s) => s.name === et.video_chat_service);
			if (!srv) {
				issues.push({
					path: `/meetings/${i}/video_chat_service`,
					message: `references unknown service "${et.video_chat_service}"`
				});
			} else if (srv.type !== 'google' && srv.type !== 'nextcloud') {
				issues.push({
					path: `/meetings/${i}/video_chat_service`,
					message: `service "${et.video_chat_service}" has type "${srv.type}", but video chat is only supported for "google" and "nextcloud" services`
				});
			} else if (srv.type === 'google') {
				const destCalType = calendarTypes.get(et.booking_calendar);
				if (destCalType && destCalType !== 'google') {
					issues.push({
						path: `/meetings/${i}/video_chat_service`,
						message: `Google Meet dynamic video chat is only supported when the booking calendar is a Google Calendar (calendar "${et.booking_calendar}" is of type "${destCalType}")`
					});
				}
			}
		}

		checkFormFields(et, i, issues);
	});

	return issues;
}

const MAX_FORM_FIELDS = 10;

function checkFormFields(
	et: WhenConfiguration['meetings'][number],
	i: number,
	issues: ConfigIssue[]
): void {
	const fields = et.form_fields;
	if (!fields) return;

	const base = `/meetings/${i}/form_fields`;

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

	const seenNames = new Set<string>();
	const typeCounts = new Map<string, number>();

	fields.forEach((field, j) => {
		if (seenNames.has(field.name)) {
			issues.push({ path: `${base}/${j}/name`, message: `duplicate form field name "${field.name}"` });
		}
		seenNames.add(field.name);
		typeCounts.set(field.type, (typeCounts.get(field.type) ?? 0) + 1);

		if (field.type === 'choice' && (field.choices?.length ?? 0) === 0) {
			issues.push({
				path: `${base}/${j}/choices`,
				message: `choice field "${field.name}" must have a non-empty choices list`
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
