const DEFAULT_CALLBACK = '/admin';
const LOCAL_ORIGIN = 'http://callback.invalid';

// Resolving against a sentinel origin turns every way out of this site — absolute,
// protocol-relative, backslash-smuggled, javascript: — into a different origin.
export function safeCallbackUrl(value: string | null | undefined): string {
	if (!value) return DEFAULT_CALLBACK;
	try {
		const url = new URL(value, LOCAL_ORIGIN);
		if (url.origin !== LOCAL_ORIGIN) return DEFAULT_CALLBACK;
		return url.pathname + url.search + url.hash;
	} catch {
		return DEFAULT_CALLBACK;
	}
}
