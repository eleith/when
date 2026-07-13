import type { WhenConfiguration, Service, Calendar, Schedule, Meeting } from './schema.js';
import type { ConfigIssue } from './load.js';

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

	const serviceRegistry = validateServices(cfg.services, issues);
	const calendarRegistry = validateCalendars(cfg.calendars, serviceRegistry.names, issues);
	const scheduleNames = validateSchedules(cfg.schedules, issues);

	validateMeetings(cfg, serviceRegistry, calendarRegistry, scheduleNames, issues);

	return issues;
}

function validateServices(
	services: WhenConfiguration['services'],
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
	srv: Service,
	i: number,
	serviceNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (serviceNames.has(srv.name)) {
		issues.push({
			path: `/services/${i}/name`,
			message: `duplicate service name "${srv.name}"`
		});
	}
}

function validateCalendars(
	calendars: WhenConfiguration['calendars'],
	serviceNames: Set<string>,
	issues: ConfigIssue[]
): CalendarRegistry {
	const calendarNames = new Set<string>();
	const calendarTypes = new Map<string, string>();

	calendars.forEach((cal, i) => {
		checkCalendarDuplicateName(cal, i, calendarNames, issues);
		checkCalendarServiceReference(cal, i, serviceNames, issues);

		calendarNames.add(cal.name);
		calendarTypes.set(cal.name, cal.type);
	});

	return { names: calendarNames, types: calendarTypes };
}

function checkCalendarDuplicateName(
	cal: Calendar,
	i: number,
	calendarNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (calendarNames.has(cal.name)) {
		issues.push({
			path: `/calendars/${i}/name`,
			message: `duplicate calendar name "${cal.name}"`
		});
	}
}

function checkCalendarServiceReference(
	cal: Calendar,
	i: number,
	serviceNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (!serviceNames.has(cal.service)) {
		issues.push({
			path: `/calendars/${i}/service`,
			message: `references unknown service "${cal.service}"`
		});
	}
}

function validateSchedules(
	schedules: WhenConfiguration['schedules'],
	issues: ConfigIssue[]
): Set<string> {
	const scheduleNames = new Set<string>();
	schedules.forEach((sch, i) => {
		checkScheduleDuplicateName(sch, i, scheduleNames, issues);
		checkScheduleHasWindows(sch, i, issues);
		scheduleNames.add(sch.name);
	});
	return scheduleNames;
}

function checkScheduleHasWindows(sch: Schedule, i: number, issues: ConfigIssue[]): void {
	const windows = Object.values(sch.weekly).reduce((sum, day) => sum + (day?.length ?? 0), 0);
	if (windows === 0) {
		issues.push({
			path: `/schedules/${i}/weekly`,
			message: `schedule "${sch.name}" has no available time windows`
		});
	}
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

	(meeting.busy_calendars ?? []).forEach((cid, j) => {
		if (!calendarRegistry.names.has(cid)) {
			issues.push({
				path: `/meetings/${i}/busy_calendars/${j}`,
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
	if (meeting.video_chat_service) {
		validateVideoChatService(meeting, i, serviceRegistry, calendarTypes, issues);
	}
}

function validateSelectBookingStyle(meeting: Meeting, i: number, issues: ConfigIssue[]): void {
	const start_times_every_minutes = meeting.start_times_every_minutes ?? meeting.duration_minutes;
	if (start_times_every_minutes < meeting.duration_minutes) {
		issues.push({
			path: `/meetings/${i}/start_times_every_minutes`,
			message: `in "select" booking style, start_times_every_minutes (${start_times_every_minutes}) must be greater than or equal to the meeting duration_minutes (${meeting.duration_minutes}) to prevent overlapping slot buttons`
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
	const serviceType = serviceRegistry.types.get(meeting.video_chat_service!);
	if (!serviceType) {
		issues.push({
			path: `/meetings/${i}/video_chat_service`,
			message: `references unknown service "${meeting.video_chat_service}"`
		});
	} else if (serviceType !== 'google' && serviceType !== 'nextcloud') {
		issues.push({
			path: `/meetings/${i}/video_chat_service`,
			message: `service "${meeting.video_chat_service}" has type "${serviceType}", but video chat is only supported for "google" and "nextcloud" services`
		});
	} else if (serviceType === 'google') {
		const destCalType = calendarTypes.get(meeting.booking_calendar);
		if (destCalType && destCalType !== 'google') {
			issues.push({
				path: `/meetings/${i}/video_chat_service`,
				message: `Google Meet dynamic video chat is only supported when the booking calendar is a Google Calendar (calendar "${meeting.booking_calendar}" is of type "${destCalType}")`
			});
		}
	}
}

const MAX_FORM_FIELDS = 10;

function checkFormFields(meeting: Meeting, i: number, issues: ConfigIssue[]): void {
	const fields = meeting.form_fields;
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
			issues.push({
				path: `${base}/${j}/name`,
				message: `duplicate form field name "${field.name}"`
			});
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
