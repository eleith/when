import { defaultAvatar } from '$lib/server/avatar';
import { getConfig } from '$lib/server/state';
import { getContrastText } from '$lib/server/color';
import type { RequestHandler } from './$types';

// The default for appearance.avatar_path: a deterministic avatar generated from
// the schedule owner's name, tinted with the configured brand colors so it
// matches the theme. Users override by pointing avatar_path elsewhere.
export const GET: RequestHandler = () => {
	const { name, appearance } = getConfig().user;
	const svg = defaultAvatar(name, {
		backgroundColor: appearance.primary_dark_color,
		textColor: getContrastText(appearance.primary_dark_color, appearance.text_dark_color)
	});
	return new Response(svg, {
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': 'public, max-age=3600'
		}
	});
};
