import type { XmlElement } from '@rgrove/parse-xml';
import {
	CALDAV,
	readDavMultiStatus,
	childElements,
	hasName,
	directText,
	leafText,
	matchingChildren
} from './caldav-xml.js';

// Retain the existing text ceiling; this is not a measured heap limit.
export const MAX_CALDAV_REPORT_CODE_UNITS = 16 * 1024 * 1024;

export function readCalDavReport(xml: string): string[] {
	if (xml.length > MAX_CALDAV_REPORT_CODE_UNITS) {
		invalidReport(`XML exceeds ${MAX_CALDAV_REPORT_CODE_UNITS} UTF-16 code units`);
	}
	const root = readDavMultiStatus(xml);
	const out: string[] = [];
	for (const response of childElements(root)) {
		if (hasName(response, 'responsedescription')) {
			leafText(response);
			continue;
		}
		if (!hasName(response, 'response') || directText(response).trim()) {
			invalidReport('expected DAV response');
		}
		if (!leafText(requiredChild(response, 'href'))) invalidReport('missing resource href');
		if (matchingChildren(response, 'status').length) {
			const status = reportStatus(response);
			if (status < 200 || status >= 300) invalidReport(`resource status ${status}`);
		}
		const data: XmlElement[] = [];
		for (const propstat of matchingChildren(response, 'propstat')) {
			const prop = requiredChild(propstat, 'prop');
			if (directText(propstat).trim() || directText(prop).trim()) {
				invalidReport('unexpected DAV property text');
			}
			const calendarData = matchingChildren(prop, 'calendar-data', CALDAV);
			const status = reportStatus(propstat);
			if (calendarData.length && (status < 200 || status >= 300)) {
				invalidReport(`calendar-data status ${status}`);
			}
			data.push(...calendarData);
		}
		if (data.length !== 1) invalidReport('expected one calendar-data per resource');
		const ics = leafText(data[0]);
		if (!ics) invalidReport('expected nonempty calendar-data');
		out.push(ics);
	}
	return out;
}

function requiredChild(element: XmlElement, name: string): XmlElement {
	const matches = matchingChildren(element, name);
	if (matches.length !== 1) invalidReport(`expected one ${name}`);
	return matches[0];
}

function reportStatus(element: XmlElement): number {
	const status = leafText(requiredChild(element, 'status'));
	const match = /^HTTP\/\d+\.\d+ ([1-5]\d{2})(?:[ \t]+[^\r\n]*)?$/.exec(status);
	if (!match) invalidReport('malformed DAV status');
	return Number(match[1]);
}

function invalidReport(reason: string): never {
	throw new Error(`Invalid CalDAV REPORT: ${reason}`);
}
