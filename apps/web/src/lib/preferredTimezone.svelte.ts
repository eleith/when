import { getContext, setContext } from 'svelte';

// The viewer's preferred display timezone, request-scoped via context (never a
// module global — that would leak across SSR requests). Seeded from the `tz`
// cookie for flash-free SSR, or null until the client resolves it.
// See docs/architecture.md → Time.
const KEY = Symbol('preferredTimezone');

class PreferredTimezone {
	current = $state<string | null>(null);

	constructor(initial: string | null) {
		this.current = initial;
	}

	set(value: string, opts: { persist?: boolean } = {}): void {
		this.current = value;
		if (opts.persist && typeof document !== 'undefined') {
			document.cookie = `tz=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
		}
	}
}

export function createPreferredTimezone(initial: string | null): PreferredTimezone {
	return setContext(KEY, new PreferredTimezone(initial));
}

export function getPreferredTimezone(): PreferredTimezone {
	return getContext<PreferredTimezone>(KEY);
}
