import { tzCity, tzOffset } from '#lib/datetime.js';

export interface TimezoneEntry {
	tz: string;
	city: string;
	tzName: string;
	offset: string;
	tokens: string[];
}

export interface TimezoneIndex {
	entries: TimezoneEntry[];
	byTz: Map<string, TimezoneEntry>;
}

function getAcronyms(str: string): string[] {
	if (!str) return [];
	const words = str.split(/\s+/).filter(Boolean);
	if (words.length < 2) return [];
	const full = words
		.map((w) => w[0])
		.join('')
		.toLowerCase();
	const noTime = words
		.filter((w) => w.toLowerCase() !== 'time')
		.map((w) => w[0])
		.join('')
		.toLowerCase();
	return [full, noTime].filter(Boolean);
}

/**
 * Builds a structured TimezoneEntry for an IANA timezone identifier, extracting
 * its city, human-readable timezone name, GMT/UTC offset, and search tokens.
 */
export function buildTimezoneEntry(tz: string, now: Date = new Date()): TimezoneEntry {
	const city = tzCity(tz);
	const region = tz.split('/')[0]?.replace(/_/g, ' ') ?? '';
	const offset = tzOffset(tz);

	let tzName = '';
	try {
		const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longGeneric' });
		tzName = fmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
	} catch {
		// ignore unsupported timeZone styles
	}
	if (!tzName || tzName.startsWith('GMT') || tzName.startsWith('UTC')) {
		try {
			const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'long' });
			tzName = fmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
		} catch {
			// ignore unsupported timeZone styles
		}
	}

	const tokens = new Set<string>([
		tz.toLowerCase(),
		city.toLowerCase(),
		region.toLowerCase(),
		offset.toLowerCase(),
		offset.replace('GMT', 'UTC').toLowerCase()
	]);

	const addText = (text: string | undefined) => {
		if (!text) return;
		const lower = text.toLowerCase();
		tokens.add(lower);
		for (const w of lower.split(/[\s/_,-]+/)) {
			if (w.length > 0) tokens.add(w);
		}
	};

	addText(tz);
	addText(city);
	addText(region);
	if (tzName) addText(tzName);

	const jan = new Date(now.getFullYear(), 0, 15);
	const jul = new Date(now.getFullYear(), 6, 15);

	for (const d of [jan, jul]) {
		for (const style of ['long', 'short', 'longGeneric', 'shortGeneric'] as const) {
			try {
				const val = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: style })
					.formatToParts(d)
					.find((p) => p.type === 'timeZoneName')?.value;
				if (val) {
					addText(val);
					for (const acr of getAcronyms(val)) {
						tokens.add(acr);
					}
				}
			} catch {
				// ignore unsupported timeZone styles
			}
		}
	}

	if (tz === 'Europe/London') {
		tokens.add('bst');
	}
	if (tz.startsWith('Europe/')) {
		if (offset === 'GMT+1' || offset === 'GMT+2') {
			tokens.add('cet');
			tokens.add('cest');
		}
	}

	return {
		tz,
		city,
		tzName,
		offset,
		tokens: Array.from(tokens)
	};
}

let cachedIndexPromise: Promise<TimezoneIndex> | null = null;

async function buildTimezoneIndex(
	allTimezones: string[] | undefined,
	now: Date
): Promise<TimezoneIndex> {
	const list = allTimezones ?? Intl.supportedValuesOf('timeZone');
	const entries: TimezoneEntry[] = [];
	const batchSize = 8;

	for (let start = 0; start < list.length; start += batchSize) {
		// Let the dialog paint before the first batch and yield between batches.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		for (const tz of list.slice(start, start + batchSize)) {
			entries.push(buildTimezoneEntry(tz, now));
		}
	}

	return {
		entries,
		byTz: new Map(entries.map((entry) => [entry.tz, entry]))
	};
}

/**
 * Builds the search index on demand, yielding between small batches of Intl work.
 * Default callers share pending work and the completed result; subsets are uncached.
 */
export function getTimezoneIndex(
	allTimezones?: string[],
	now: Date = new Date()
): Promise<TimezoneIndex> {
	if (allTimezones) return buildTimezoneIndex(allTimezones, now);

	if (!cachedIndexPromise) {
		cachedIndexPromise = buildTimezoneIndex(undefined, now).catch((error) => {
			cachedIndexPromise = null;
			throw error;
		});
	}
	return cachedIndexPromise;
}

/**
 * Searches the timezone index for matches against a query string.
 * Supports multi-word queries, abbreviations (e.g. PST, EST, CET, BST),
 * city names, regions, and GMT/UTC offsets.
 */
export function searchTimezones(query: string, index: TimezoneIndex): TimezoneEntry[] {
	const qTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (qTerms.length === 0) {
		return index.entries;
	}

	return index.entries.filter((entry) => {
		return qTerms.every((term) => entry.tokens.some((token) => token.startsWith(term)));
	});
}
