import { sequence } from '@sveltejs/kit/hooks';
import { redirect, error } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { bootApp } from '$lib/server/boot';
import { logger } from '$lib/server/logger';
import { getConfig } from '$lib/server/state';

try {
	await bootApp();
} catch (err) {
	logger.fatal({ err }, 'boot failed — exiting');
	process.exit(1);
}

export const handle = sequence(getAuth().handle, async ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(auth)')) {
		const session = await event.locals.auth();
		if (!session) {
			const accept = event.request.headers.get('accept') || '';
			if (event.request.method === 'GET' && accept.includes('text/html')) {
				const callbackUrl = event.url.pathname + event.url.search;
				throw redirect(303, `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
			} else {
				throw error(403, 'Not authorized.');
			}
		}
	}

	const cfg = getConfig();
	const primary = cfg.user.branding.color.primary;

	return resolve(event, {
		transformPageChunk: ({ html }) => {
			const styleTag = `<style>
		:root {
			--primary: ${primary.light};
			--primary-muted: oklch(from var(--primary) 0.97 0.02 h);
			--primary-border: oklch(from var(--primary) 0.92 0.05 h);
		}

		@media (prefers-color-scheme: dark) {
			:root {
				--primary: ${primary.dark};
				--primary-muted: oklch(from var(--primary) 0.15 0.05 h);
				--primary-border: oklch(from var(--primary) 0.25 0.1 h);
			}
		}
	</style>`;
			return html.replace('</head>', `\t${styleTag}\n</head>`);
		}
	});
});
