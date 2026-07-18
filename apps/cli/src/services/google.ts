// Parse the auth code from a pasted redirect URL (the CLI's `service token`
// paste UX); the OAuth protocol itself lives in @when/calendar.
export function extractAuthCode(input: string): string {
	if (input.startsWith('http://') || input.startsWith('https://') || input.includes('code=')) {
		try {
			const code = new URL(input).searchParams.get('code');
			if (code) return code;
		} catch {
			// input isn't a URL; fall through and treat it as the raw code
		}
	}
	return input;
}
