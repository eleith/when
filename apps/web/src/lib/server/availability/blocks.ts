import type { Interval } from './types';

/** Sort and merge overlapping/touching intervals. */
export function mergeBlocks(blocks: Interval[]): Interval[] {
	if (blocks.length === 0) return [];
	const sorted = [...blocks].sort((a, b) => Temporal.Instant.compare(a.start, b.start));
	const merged: Interval[] = [{ start: sorted[0].start, end: sorted[0].end }];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		const cur = sorted[i];
		if (Temporal.Instant.compare(cur.start, last.end) <= 0) {
			if (Temporal.Instant.compare(cur.end, last.end) > 0) {
				last.end = cur.end;
			}
		} else {
			merged.push({ start: cur.start, end: cur.end });
		}
	}
	return merged;
}

/** True iff [a.start, a.end] overlaps any block (open intervals: touching is fine). */
export function overlapsAny(a: Interval, blocks: Interval[]): boolean {
	for (const b of blocks) {
		if (
			Temporal.Instant.compare(a.start, b.end) < 0 &&
			Temporal.Instant.compare(b.start, a.end) < 0
		) {
			return true;
		}
	}
	return false;
}
