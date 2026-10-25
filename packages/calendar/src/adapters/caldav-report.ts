const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';

interface ReportElement {
	name: string;
	namespace: string;
	text: string;
	children: ReportElement[];
}

export function readCalDavReport(xml: string): string[] {
	const root = parseReportXml(xml);
	if (root.name !== 'multistatus' || root.namespace !== DAV || root.text.trim()) {
		invalidReport('expected DAV multistatus');
	}
	const out: string[] = [];
	for (const response of root.children) {
		if (response.namespace === DAV && response.name === 'responsedescription') {
			if (response.children.length) invalidReport('unexpected DAV description content');
			continue;
		}
		if (response.namespace !== DAV || response.name !== 'response' || response.text.trim()) {
			invalidReport('expected DAV response');
		}
		const href = requiredChild(response, 'href');
		if (!href.text.trim() || href.children.length) invalidReport('missing resource href');
		if (children(response, 'status').length) {
			const status = reportStatus(response);
			if (status < 200 || status >= 300) invalidReport(`resource status ${status}`);
		}
		const data: ReportElement[] = [];
		for (const propstat of children(response, 'propstat')) {
			const prop = requiredChild(propstat, 'prop');
			if (propstat.text.trim() || prop.text.trim()) invalidReport('unexpected DAV property text');
			const calendarData = children(prop, 'calendar-data', CALDAV);
			const status = reportStatus(propstat);
			if (calendarData.length && (status < 200 || status >= 300)) {
				invalidReport(`calendar-data status ${status}`);
			}
			data.push(...calendarData);
		}
		if (data.length !== 1 || data[0].children.length || !data[0].text.trim()) {
			invalidReport('expected one nonempty calendar-data per resource');
		}
		out.push(data[0].text.trim());
	}
	return out;
}

export function decodeXmlEntities(s: string): string {
	const named: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
	return s.replace(/&(?:([^&;\s]+);)?/g, (_entity, name: string | undefined) => {
		if (name && Object.hasOwn(named, name)) return named[name];
		if (name && /^(?:#\d+|#x[\da-fA-F]+)$/.test(name)) {
			const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			if (
				code === 9 ||
				code === 10 ||
				code === 13 ||
				(code >= 0x20 && code <= 0xd7ff) ||
				(code >= 0xe000 && code <= 0xfffd) ||
				(code >= 0x10000 && code <= 0x10ffff)
			) {
				return String.fromCodePoint(code);
			}
		}
		throw new Error('Invalid CalDAV XML entity');
	});
}

function children(element: ReportElement, name: string, namespace = DAV): ReportElement[] {
	return element.children.filter((child) => child.name === name && child.namespace === namespace);
}

function requiredChild(element: ReportElement, name: string): ReportElement {
	const matches = children(element, name);
	if (matches.length !== 1) invalidReport(`expected one ${name} in ${element.name}`);
	return matches[0];
}

function reportStatus(element: ReportElement): number {
	const status = requiredChild(element, 'status');
	const match = /^HTTP\/\d+\.\d+ ([1-5]\d{2})(?:[ \t]+[^\r\n]*)?$/.exec(status.text.trim());
	if (!match || status.children.length) invalidReport('malformed DAV status');
	return Number(match[1]);
}

function invalidReport(reason: string): never {
	throw new Error(`Invalid CalDAV REPORT: ${reason}`);
}

function parseOpeningTag(token: string, parentNamespaces?: Map<string, string>) {
	const namePattern = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
	const opening = new RegExp(`^<(${namePattern})([^]*?)(/?)>$`);
	const attribute = new RegExp(`\\s+(${namePattern})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'gy');
	const tag = opening.exec(token);
	if (!tag) invalidReport('unsupported or malformed XML tag');
	const [, qualifiedName, attributeText, selfClosing] = tag;
	const namespaces = new Map(parentNamespaces ?? [['xml', 'http://www.w3.org/XML/1998/namespace']]);
	const attributes = new Set<string>();
	let position = 0;
	while (position < attributeText.trimEnd().length) {
		attribute.lastIndex = position;
		const attr = attribute.exec(attributeText);
		if (!attr) invalidReport('malformed XML attributes');
		const [, name, doubleQuoted, singleQuoted] = attr;
		if (attributes.has(name)) invalidReport('duplicate XML attribute');
		attributes.add(name);
		const value = decodeXmlEntities(doubleQuoted ?? singleQuoted);
		if (name === 'xmlns') namespaces.set('', value);
		else if (name.startsWith('xmlns:')) namespaces.set(name.slice(6), value);
		position = attribute.lastIndex;
	}
	const parts = qualifiedName.split(':');
	const prefix = parts.length === 2 ? parts[0] : '';
	if (prefix && !namespaces.get(prefix)) invalidReport('undeclared XML namespace');
	const element: ReportElement = {
		name: parts.at(-1)!,
		namespace: namespaces.get(prefix) ?? '',
		text: '',
		children: []
	};
	return { element, qualifiedName, namespaces, selfClosing: Boolean(selfClosing) };
}

// Deliberately limited XML subset for DAV: no DTDs, external entities or processing
// instructions. Tokenize before decoding so CDATA/escaped text cannot become tags.
function parseReportXml(xml: string): ReportElement {
	if (xml.length > 16 * 1024 * 1024) invalidReport('XML exceeds size limit');
	// eslint-disable-next-line no-control-regex -- reject characters forbidden by XML 1.0
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(xml)) {
		invalidReport('invalid XML character');
	}
	const tokens =
		/<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>|<\/[^<>]*>|<(?:"[^"<]*"|'[^'<]*'|[^<>"'])*>|[^<]+/gy;
	const stack: ReturnType<typeof parseOpeningTag>[] = [];
	let root: ReportElement | undefined;
	let offset = 0;
	while (offset < xml.length) {
		tokens.lastIndex = offset;
		const match = tokens.exec(xml);
		if (!match) invalidReport('malformed XML');
		const token = match[0];
		const parent = stack.at(-1);
		if (token.startsWith('<!--')) {
			if (token.slice(4, -3).includes('--') || token.slice(4, -3).endsWith('-'))
				invalidReport('malformed XML comment');
		} else if (token.startsWith('<?')) {
			if (
				offset !== 0 ||
				!/^<\?xml\s+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:\s+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:\s+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/.test(
					token
				)
			) {
				invalidReport('unsupported XML declaration');
			}
		} else if (token.startsWith('<![CDATA[')) {
			if (!parent) invalidReport('CDATA outside root');
			parent.element.text += token.slice(9, -3);
		} else if (token.startsWith('</')) {
			if (!parent || token.slice(2, -1).trimEnd() !== parent.qualifiedName) {
				invalidReport('mismatched XML closing tag');
			}
			stack.pop();
		} else if (token.startsWith('<')) {
			const frame = parseOpeningTag(token, parent?.namespaces);
			const { element } = frame;
			if (parent) parent.element.children.push(element);
			else if (root) invalidReport('multiple XML roots');
			else root = element;
			if (!frame.selfClosing) stack.push(frame);
			if (stack.length > 32) invalidReport('XML nesting exceeds 32 levels');
		} else {
			if (token.includes(']]>')) invalidReport('malformed XML text');
			const text = decodeXmlEntities(token);
			if (parent) parent.element.text += text;
			else if (text.trim()) invalidReport('text outside XML root');
		}
		offset = tokens.lastIndex;
	}
	if (!root || stack.length) invalidReport('missing or truncated XML root');
	return root;
}
