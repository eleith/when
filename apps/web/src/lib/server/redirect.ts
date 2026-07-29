// Resolving against the origin we require turns every way out of this site — absolute,
// protocol-relative, backslash-smuggled, javascript: — into a different origin.
export function localRedirect(
	value: string | null | undefined,
	origin: string,
	fallback: string
): string {
	if (!value) return fallback;
	try {
		const url = new URL(value, origin);
		if (url.origin !== origin) return fallback;
		return url.pathname + url.search + url.hash;
	} catch {
		return fallback;
	}
}
