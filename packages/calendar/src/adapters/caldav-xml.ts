import {
	parseXml,
	XmlElement,
	XmlText,
	XmlDocumentType,
	XmlDeclaration,
	type XmlNode
} from '@rgrove/parse-xml';

export const DAV = 'DAV:';
export const CALDAV = 'urn:ietf:params:xml:ns:caldav';

/** Parse a DAV response once; callers own REPORT or discovery-specific interpretation. */
export function readDavMultiStatus(xml: string): XmlElement {
	let document;
	try {
		// Normalize XML 1.0 newlines once, avoiding repeated library copies on CRLF-heavy data.
		// Character references are decoded afterward, so numeric CRs remain intact.
		document = parseXml(xml.replace(/\r\n?/g, '\n'), {
			preserveDocumentType: true,
			preserveXmlDeclaration: true
		});
	} catch {
		// Library errors include input excerpts; never expose calendar contents.
		invalidXml('parsing failed');
	}
	if (document.children.some((node) => node instanceof XmlDocumentType)) {
		invalidXml('DTD is not supported');
	}
	if (document.children.some((node) => node instanceof XmlDeclaration && node.version !== '1.0')) {
		invalidXml('unsupported XML version');
	}
	const root = document.root;
	if (!root || !hasName(root, 'multistatus') || directText(root).trim()) {
		invalidXml('expected DAV multistatus');
	}
	return root;
}

export function childElements(element: XmlElement): XmlElement[] {
	return element.children.filter((node): node is XmlElement => node instanceof XmlElement);
}

export function directText(element: XmlElement): string {
	return element.children
		.filter((node): node is XmlText => node instanceof XmlText)
		.map((node) => node.text)
		.join('');
}

export function leafText(element: XmlElement): string {
	if (childElements(element).length) invalidXml('unexpected nested property content');
	return directText(element).trim();
}

// Match the requested qualified name and its in-scope namespace, without validating
// namespace conformance inside ignored extension content.
export function hasName(element: XmlElement, local: string, namespace = DAV): boolean {
	const colon = element.name.indexOf(':');
	const prefix = colon < 0 ? '' : element.name.slice(0, colon);
	if (colon === 0 || prefix === 'xml' || prefix === 'xmlns') return false;
	if (element.name !== (prefix ? `${prefix}:${local}` : local)) return false;
	const declaration = prefix ? `xmlns:${prefix}` : 'xmlns';
	for (let scope: XmlNode | null = element; scope instanceof XmlElement; scope = scope.parent) {
		if (Object.hasOwn(scope.attributes, declaration)) {
			return scope.attributes[declaration] === namespace;
		}
	}
	return false;
}

export function matchingChildren(element: XmlElement, name: string, namespace = DAV): XmlElement[] {
	return childElements(element).filter((child) => hasName(child, name, namespace));
}

function invalidXml(reason: string): never {
	throw new Error(`Invalid CalDAV XML: ${reason}`);
}
