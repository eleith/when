import type { WhenConfiguration, Provider, Schedule, Meeting, FormField } from './schema.js';
import type { ConfigIssue } from './load.js';
import { durationsOf } from './durations.js';

interface ServiceRegistry {
	names: Set<string>;
	types: Map<string, string>;
}

interface CalendarRegistry {
	names: Set<string>;
	types: Map<string, string>;
}

export function checkCrossRefs(cfg: WhenConfiguration): ConfigIssue[] {
	const issues: ConfigIssue[] = [];

	const serviceRegistry = validateServices(cfg.providers, issues);
	const calendarRegistry = validateCalendars(cfg, issues);
	const scheduleNames = validateSchedules(cfg.schedules, issues);

	validateMeetings(cfg, serviceRegistry, calendarRegistry, scheduleNames, issues);

	return issues;
}

function validateServices(
	services: WhenConfiguration['providers'],
	issues: ConfigIssue[]
): ServiceRegistry {
	const serviceNames = new Set<string>();
	const serviceTypes = new Map<string, string>();

	(services ?? []).forEach((srv, i) => {
		checkServiceDuplicateName(srv, i, serviceNames, issues);
		serviceNames.add(srv.name);
		serviceTypes.set(srv.name, srv.type);
	});

	return { names: serviceNames, types: serviceTypes };
}

function checkServiceDuplicateName(
	srv: Provider,
	i: number,
	serviceNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (serviceNames.has(srv.name)) {
		issues.push({
			path: `/providers/${i}/name`,
			message: `duplicate provider name "${srv.name}"`
		});
	}
}

// Names must be unique across every provider, since meetings reference them unqualified.
function validateCalendars(cfg: WhenConfiguration, issues: ConfigIssue[]): CalendarRegistry {
	const names = new Set<string>();
	const types = new Map<string, string>();

	cfg.providers.forEach((provider, p) => {
		provider.calendars.forEach((calendar, c) => {
			if (names.has(calendar.name)) {
				issues.push({
					path: `/providers/${p}/calendars/${c}/name`,
					message: `duplicate calendar name "${calendar.name}"`
				});
			}
			names.add(calendar.name);
			types.set(calendar.name, provider.type);
		});
	});

	return { names, types };
}

function validateSchedules(
	schedules: WhenConfiguration['schedules'],
	issues: ConfigIssue[]
): Set<string> {
	const scheduleNames = new Set<string>();
	schedules.forEach((sch, i) => {
		checkScheduleDuplicateName(sch, i, scheduleNames, issues);
		checkScheduleWindows(sch, i, issues);
		scheduleNames.add(sch.name);
	});
	return scheduleNames;
}

// HH:MM strings are zero-padded, so lexical order matches chronological order.
function checkScheduleWindows(sch: Schedule, i: number, issues: ConfigIssue[]): void {
	sch.weekly.forEach((rule, j) => {
		if (rule.from >= rule.to) {
			issues.push({
				path: `/schedules/${i}/weekly/${j}`,
				message: `schedule "${sch.name}" has an empty window (${rule.from}-${rule.to}); "from" must be earlier than "to"`
			});
		}
	});
}

function checkScheduleDuplicateName(
	sch: Schedule,
	i: number,
	scheduleNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (scheduleNames.has(sch.name)) {
		issues.push({
			path: `/schedules/${i}/name`,
			message: `duplicate schedule name "${sch.name}"`
		});
	}
}

function validateMeetings(
	cfg: WhenConfiguration,
	serviceRegistry: ServiceRegistry,
	calendarRegistry: CalendarRegistry,
	scheduleNames: Set<string>,
	issues: ConfigIssue[]
): void {
	const seenMeetingNames = new Set<string>();
	const seenSlugs = new Set<string>();

	cfg.meetings.forEach((meeting, i) => {
		checkMeetingDuplicateName(meeting, i, seenMeetingNames, issues);
		checkMeetingDuplicateSlug(meeting, i, seenSlugs, issues);
		checkMeetingCalendarReferences(meeting, i, calendarRegistry, issues);
		checkMeetingScheduleReference(meeting, i, scheduleNames, issues);
		checkMeetingBookingStyle(meeting, i, issues);
		checkMeetingVideoChatService(meeting, i, serviceRegistry, calendarRegistry.types, issues);
		checkFormFields(meeting, i, issues);

		seenMeetingNames.add(meeting.name);
		seenSlugs.add(meeting.slug);
	});
}

function checkMeetingDuplicateName(
	meeting: Meeting,
	i: number,
	seenMeetingNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (seenMeetingNames.has(meeting.name)) {
		issues.push({
			path: `/meetings/${i}/name`,
			message: `duplicate meeting name "${meeting.name}"`
		});
	}
}

function checkMeetingDuplicateSlug(
	meeting: Meeting,
	i: number,
	seenSlugs: Set<string>,
	issues: ConfigIssue[]
): void {
	if (seenSlugs.has(meeting.slug)) {
		issues.push({
			path: `/meetings/${i}/slug`,
			message: `duplicate meeting slug "${meeting.slug}"`
		});
	}
}

function checkMeetingCalendarReferences(
	meeting: Meeting,
	i: number,
	calendarRegistry: CalendarRegistry,
	issues: ConfigIssue[]
): void {
	if (!calendarRegistry.names.has(meeting.booking_calendar)) {
		issues.push({
			path: `/meetings/${i}/booking_calendar`,
			message: `references unknown calendar name "${meeting.booking_calendar}"`
		});
	}

	meeting.additional_busy_calendars.forEach((cid, j) => {
		if (!calendarRegistry.names.has(cid)) {
			issues.push({
				path: `/meetings/${i}/additional_busy_calendars/${j}`,
				message: `references unknown calendar name "${cid}"`
			});
		}
	});
}

function checkMeetingScheduleReference(
	meeting: Meeting,
	i: number,
	scheduleNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (!scheduleNames.has(meeting.schedule)) {
		issues.push({
			path: `/meetings/${i}/schedule`,
			message: `references unknown schedule name "${meeting.schedule}"`
		});
	}
}

function checkMeetingBookingStyle(meeting: Meeting, i: number, issues: ConfigIssue[]): void {
	if (meeting.booking_style === 'select') {
		validateSelectBookingStyle(meeting, i, issues);
	}
}

function checkMeetingVideoChatService(
	meeting: Meeting,
	i: number,
	serviceRegistry: ServiceRegistry,
	calendarTypes: Map<string, string>,
	issues: ConfigIssue[]
): void {
	if (meeting.video_chat_provider) {
		validateVideoChatService(meeting, i, serviceRegistry, calendarTypes, issues);
	}
}

function validateSelectBookingStyle(meeting: Meeting, i: number, issues: ConfigIssue[]): void {
	const durations = durationsOf(meeting);
	// The step defaults to the shortest length (as the app does); the longest length
	// is what must fit between buttons so they can't overlap.
	const step = meeting.start_times_every_minutes ?? Math.min(...durations);
	const longest = Math.max(...durations);
	if (step < longest) {
		issues.push({
			path: `/meetings/${i}/start_times_every_minutes`,
			message: `in "select" booking style, start_times_every_minutes (${step}) must be greater than or equal to the longest meeting duration (${longest}) to prevent overlapping slot buttons`
		});
	}
}

function validateVideoChatService(
	meeting: Meeting,
	i: number,
	serviceRegistry: ServiceRegistry,
	calendarTypes: Map<string, string>,
	issues: ConfigIssue[]
): void {
	const serviceType = serviceRegistry.types.get(meeting.video_chat_provider!);
	if (!serviceType) {
		issues.push({
			path: `/meetings/${i}/video_chat_provider`,
			message: `references unknown provider "${meeting.video_chat_provider}"`
		});
	} else if (serviceType !== 'google' && serviceType !== 'nextcloud') {
		issues.push({
			path: `/meetings/${i}/video_chat_provider`,
			message: `provider "${meeting.video_chat_provider}" has type "${serviceType}", but video chat is only supported for "google" and "nextcloud" providers`
		});
	} else if (serviceType === 'google') {
		const destCalType = calendarTypes.get(meeting.booking_calendar);
		if (destCalType && destCalType !== 'google') {
			issues.push({
				path: `/meetings/${i}/video_chat_provider`,
				message: `Google Meet dynamic video chat is only supported when the booking calendar is a Google Calendar (calendar "${meeting.booking_calendar}" is of type "${destCalType}")`
			});
		}
	}
}

function checkFormFields(meeting: Meeting, i: number, issues: ConfigIssue[]): void {
	const fields = meeting.form_fields;
	if (!fields) return;

	const base = `/meetings/${i}/form_fields`;
	const seenNames = new Set<string>();
	const typeCounts = new Map<string, number>();

	fields.forEach((field, j) => {
		if (seenNames.has(field.name)) {
			issues.push({
				path: `${base}/${j}/name`,
				message: `duplicate form field name "${field.name}"`
			});
		}
		seenNames.add(field.name);
		typeCounts.set(field.type, (typeCounts.get(field.type) ?? 0) + 1);

		checkFieldConditions(field, j, fields, base, issues);
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

// A show_when condition may only reference an earlier field (no forward refs or
// cycles), and an equals value must be a real option of a choice controller.
function checkFieldConditions(
	field: FormField,
	j: number,
	fields: readonly FormField[],
	base: string,
	issues: ConfigIssue[]
): void {
	if (!field.show_when) return;
	const earlier = fields.slice(0, j);
	field.show_when.forEach((cond, k) => {
		const target = earlier.find((f) => f.name === cond.field);
		if (!target) {
			issues.push({
				path: `${base}/${j}/show_when/${k}/field`,
				message: `show_when for "${field.name}" references unknown or later field "${cond.field}"`
			});
			return;
		}
		if (cond.equals === undefined || target.type !== 'choice' || !target.choices) return;
		const values = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
		for (const value of values) {
			if (!target.choices.includes(value)) {
				issues.push({
					path: `${base}/${j}/show_when/${k}`,
					message: `show_when value "${value}" is not one of "${cond.field}" choices`
				});
			}
		}
	});
}
