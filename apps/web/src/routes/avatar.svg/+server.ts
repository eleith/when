import { defaultAvatar } from '@when/avatar';
import { getConfig } from '$lib/server/state';
import type { RequestHandler } from './$types';

// The default for appearance.avatar_url: a deterministic avatar generated from
// the schedule owner's name. Users override by pointing avatar_url elsewhere.
export const GET: RequestHandler = () => {
	const { svg } = defaultAvatar(getConfig().user.name);
	return new Response(svg, {
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': 'public, max-age=3600'
		}
	});
};
