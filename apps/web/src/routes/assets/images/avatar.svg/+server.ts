import { defaultAvatar } from '$lib/server/avatar';
import { getConfig } from '$lib/server/state';
import { getContrastText } from '$lib/server/color';
import type { RequestHandler } from './$types';

const CACHE_CONTROL = 'public, max-age=3600';

// The default for appearance.avatar_path: a deterministic avatar generated from
// the schedule owner's name, tinted with the configured brand colors so it
// matches the theme. Users override by pointing avatar_path elsewhere.
export const GET: RequestHandler = () => {
	const { name, appearance } = getConfig().user;
	const shapeColor = appearance.primary_dark_color;
	const textColor = getContrastText(shapeColor, appearance.text_dark_color);
	const svg = defaultAvatar(name, {
		backgroundColor: appearance.background_light_color,
		shapeColor,
		textColor
	});

	return new Response(svg, {
		headers: {
			'content-type': 'image/svg+xml',
			'cache-control': CACHE_CONTROL
		}
	});
};
