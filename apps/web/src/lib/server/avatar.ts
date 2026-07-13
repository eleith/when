import { Avatar, Style } from '@dicebear/core';
// DiceBear "initial-face" style, vendored (CC0 1.0, see meta.license in the JSON).
import initialFace from './initial-face.json';

const style = new Style(initialFace);

export interface AvatarColors {
	// Face background. Hex, with or without a leading '#'.
	backgroundColor?: string;
	// Face features (eyes + mouth) — the readable "ink" over the background.
	textColor?: string;
}

// A deterministic default avatar seeded from a string (the owner's name), so the
// same input always renders the same face. Colors default to the style's palette;
// pass brand colors to match the app's theme. Returns an SVG string.
export function defaultAvatar(seed: string, colors: AvatarColors = {}): string {
	const hex = (c: string) => [c.replace(/^#/, '')];
	return new Avatar(style, {
		seed,
		...(colors.backgroundColor && { backgroundColor: hex(colors.backgroundColor) }),
		...(colors.textColor && { eyesColor: hex(colors.textColor), mouthColor: hex(colors.textColor) })
	}).toString();
}
