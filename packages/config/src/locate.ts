import { LineCounter, isNode, parseDocument } from 'yaml';

export interface SourceLocation {
	line: number;
	column: number;
	missing: string | null;
}

function segments(pointer: string): (string | number)[] {
	return pointer
		.split('/')
		.filter((part) => part !== '')
		.map((part) => {
			const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
			return /^\d+$/.test(key) ? Number(key) : key;
		});
}

export function locateInYaml(text: string, pointer: string): SourceLocation | null {
	const lineCounter = new LineCounter();
	const doc = parseDocument(text, { lineCounter });
	const path = segments(pointer);

	for (let depth = path.length; depth >= 0; depth--) {
		const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
		if (!isNode(node) || !node.range) continue;
		const { line, col } = lineCounter.linePos(node.range[0]);
		const tail = path.slice(depth).join('/');
		return { line, column: col, missing: tail === '' ? null : tail };
	}
	return null;
}
