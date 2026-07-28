const DEL = 0x7f;
const FIRST_PRINTABLE = 0x20;

function removeControlChars(text: string, keep: string): string {
	return [...text]
		.filter((ch) => {
			if (keep.includes(ch)) return true;
			const code = ch.codePointAt(0) ?? 0;
			return code >= FIRST_PRINTABLE && code !== DEL;
		})
		.join('');
}

// ts-ics escapes property values but not parameters, and neither against a bare CR.
export function icsValue(text: string): string {
	return removeControlChars(text.replace(/\r\n?/g, '\n'), '\n\t');
}

export function icsParameter(text: string): string {
	return removeControlChars(text.replace(/[\r\n\t]+/g, ' '), '')
		.replace(/"/g, '')
		.replace(/[;:,]/g, ' ');
}
