export function localRedirect(
	value: string | null | undefined,
	origin: string,
	fallback: string
): string {
	if (!value) return fallback;
	try {
		const requested = new URL(value, origin);
		const path = requested.pathname + requested.search + requested.hash;
		const destination = new URL(path, origin);
		if (requested.origin !== origin || destination.origin !== origin) return fallback;
		return path;
	} catch {
		return fallback;
	}
}
