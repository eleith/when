import type { WhenConfiguration, Schedule, Meeting, FormField } from './schema.js';
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

	const serviceRegistry = providerRegistry(cfg.providers);
	const calendarRegistry = validateCalendars(cfg, issues);
	const scheduleNames = validateSchedules(cfg.schedules, issues);

	validateMeetings(cfg, serviceRegistry, calendarRegistry, scheduleNames, issues);

	return issues;
}

function providerRegistry(providers: WhenConfiguration['providers']): ServiceRegistry {
	const names = new Set<string>();
	const types = new Map<string, string>();
	for (const [name, provider] of Object.entries(providers)) {
		names.add(name);
		types.set(name, provider.type);
	}
	return { names, types };
}

// Calendar keys are unique within a provider by construction, but meetings reference
// them unqualified, so they must not collide across providers either.
function validateCalendars(cfg: WhenConfiguration, issues: ConfigIssue[]): CalendarRegistry {
	const names = new Set<string>();
	const types = new Map<string, string>();

	for (const [providerName, provider] of Object.entries(cfg.providers)) {
		for (const name of Object.keys(provider.calendars)) {
			if (names.has(name)) {
				issues.push({
					path: `/providers/${providerName}/calendars/${name}`,
					message: `calendar "${name}" is already defined on another provider`
				});
			}
			names.add(name);
			types.set(name, provider.type);
		}
	}

	return { names, types };
}

function validateSchedules(
	schedules: WhenConfiguration['schedules'],
	issues: ConfigIssue[]
): Set<string> {
	for (const [name, schedule] of Object.entries(schedules)) {
		checkScheduleWindows(name, schedule, issues);
	}
	return new Set(Object.keys(schedules));
}

// HH:MM strings are zero-padded, so lexical order matches chronological order.
function checkScheduleWindows(name: string, sch: Schedule, issues: ConfigIssue[]): void {
	sch.weekly.forEach((rule, j) => {
		if (rule.from >= rule.to) {
			issues.push({
				path: `/schedules/${name}/weekly/${j}`,
				message: `schedule "${name}" has an empty window (${rule.from}-${rule.to}); "from" must be earlier than "to"`
			});
		}
	});
}

function validateMeetings(
	cfg: WhenConfiguration,
	serviceRegistry: ServiceRegistry,
	calendarRegistry: CalendarRegistry,
	scheduleNames: Set<string>,
	issues: ConfigIssue[]
): void {
	for (const [key, meeting] of Object.entries(cfg.meetings)) {
		checkMeetingCalendarReferences(key, meeting, calendarRegistry, issues);
		checkMeetingScheduleReference(key, meeting, scheduleNames, issues);
		checkMeetingVideoChatService(key, meeting, serviceRegistry, calendarRegistry.types, issues);
		checkFormFields(key, meeting, issues);
	}
}

function checkMeetingCalendarReferences(
	key: string,
	meeting: Meeting,
	calendarRegistry: CalendarRegistry,
	issues: ConfigIssue[]
): void {
	if (!calendarRegistry.names.has(meeting.booking_calendar)) {
		issues.push({
			path: `/meetings/${key}/booking_calendar`,
			message: `references unknown calendar name "${meeting.booking_calendar}"`
		});
	}

	meeting.additional_busy_calendars.forEach((cid, j) => {
		if (!calendarRegistry.names.has(cid)) {
			issues.push({
				path: `/meetings/${key}/additional_busy_calendars/${j}`,
				message: `references unknown calendar name "${cid}"`
			});
		}
	});
}

function checkMeetingScheduleReference(
	key: string,
	meeting: Meeting,
	scheduleNames: Set<string>,
	issues: ConfigIssue[]
): void {
	if (!scheduleNames.has(meeting.schedule)) {
		issues.push({
			path: `/meetings/${key}/schedule`,
			message: `references unknown schedule name "${meeting.schedule}"`
		});
	}
}

function checkMeetingVideoChatService(
	key: string,
	meeting: Meeting,
	serviceRegistry: ServiceRegistry,
	calendarTypes: Map<string, string>,
	issues: ConfigIssue[]
): void {
	if (meeting.video_chat) {
		validateVideoChatService(key, meeting, serviceRegistry, calendarTypes, issues);
	}
}

function validateVideoChatService(
	key: string,
	meeting: Meeting,
	serviceRegistry: ServiceRegistry,
	calendarTypes: Map<string, string>,
	issues: ConfigIssue[]
): void {
	const videoChat = meeting.video_chat!;
	const serviceType = serviceRegistry.types.get(videoChat.provider);
	if (!serviceType) {
		issues.push({
			path: `/meetings/${key}/video_chat/provider`,
			message: `references unknown provider "${videoChat.provider}"`
		});
	} else if (serviceType !== 'google' && serviceType !== 'nextcloud') {
		issues.push({
			path: `/meetings/${key}/video_chat/provider`,
			message: `provider "${videoChat.provider}" has type "${serviceType}", but video chat is only supported for "google" and "nextcloud" providers`
		});
	} else if (serviceType === 'google') {
		const destCalType = calendarTypes.get(meeting.booking_calendar);
		if (destCalType && destCalType !== 'google') {
			issues.push({
				path: `/meetings/${key}/video_chat/provider`,
				message: `Google Meet dynamic video chat is only supported when the booking calendar is a Google Calendar (calendar "${meeting.booking_calendar}" is of type "${destCalType}")`
			});
		}
	}

	if (videoChat.attach && 'when' in videoChat.attach && videoChat.attach.when) {
		const fields = meeting.form_fields ?? [];
		videoChat.attach.when.forEach((cond, k) => {
			const target = fields.find((f) => f.name === cond.field);
			if (!target) {
				issues.push({
					path: `/meetings/${key}/video_chat/attach/when/${k}/field`,
					message: `video_chat attach condition references unknown form field "${cond.field}"`
				});
				return;
			}
			if (cond.equals === undefined || target.type !== 'choice' || !target.choices) return;
			const values = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
			for (const value of values) {
				if (!target.choices.includes(value)) {
					issues.push({
						path: `/meetings/${key}/video_chat/attach/when/${k}`,
						message: `video_chat attach condition value "${value}" is not one of "${cond.field}" choices`
					});
				}
			}
		});
	}
}

function checkFormFields(key: string, meeting: Meeting, issues: ConfigIssue[]): void {
	const fields = meeting.form_fields;
	if (!fields) return;

	const base = `/meetings/${key}/form_fields`;
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
