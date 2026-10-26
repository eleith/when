/** Bound retained REPORT text while reading, using the existing UTF-16 string-length budget. */
export async function readCalDavReportBody(
	response: Response,
	maxCodeUnits: number
): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let xml = '';
	function append(text: string): void {
		if (xml.length + text.length > maxCodeUnits) {
			throw new Error(`Invalid CalDAV REPORT: XML exceeds ${maxCodeUnits} UTF-16 code units`);
		}
		xml += text;
	}
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			append(decoder.decode(value, { stream: true }));
		}
		append(decoder.decode());
		return xml;
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// Cancellation must not hide the original read or size failure.
		}
		throw error;
	} finally {
		reader.releaseLock();
	}
}
