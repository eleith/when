import { Avatar, Style } from '@dicebear/core';
// DiceBear "thumbs" style, vendored (CC0 1.0, see meta.license in the JSON).
import thumbs from './thumbs.json';

const style = new Style(thumbs);

export interface AvatarColors {
	// Canvas background. Hex, with or without a leading '#'.
	backgroundColor?: string;
	// Thumb character body shape color. Defaults to backgroundColor if omitted.
	shapeColor?: string;
	// Face features (eyes + mouth) color on top of the thumb body.
	textColor?: string;
}

// A deterministic default avatar seeded from a string (the owner's name), so the
// same input always renders the same face. Colors default to the style's palette;
// pass brand colors to match the app's theme. Returns an SVG string.
export function defaultAvatar(seed: string, colors: AvatarColors = {}): string {
	const hex = (c: string) => [c.replace(/^#/, '')];
	const shapeColor = colors.shapeColor ?? colors.backgroundColor;
	return new Avatar(style, {
		seed,
		...(colors.backgroundColor && { backgroundColor: hex(colors.backgroundColor) }),
		...(shapeColor && { shapeColor: hex(shapeColor) }),
		...(colors.textColor && {
			eyesColor: hex(colors.textColor),
			mouthColor: hex(colors.textColor)
		})
	}).toString();
}
