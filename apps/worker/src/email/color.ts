// Email needs literal hex in every inline style: clients cannot be relied on for
// css variables or color-mix(), so the web app's derived tokens are recomputed here.
const MIN_CONTRAST = 4.5;

type Channels = [number, number, number];

function toChannels(hex: string): Channels {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return [255, 255, 255];
	const digits = match[1].length === 3 ? match[1].replace(/(.)/g, '$1$1') : match[1];
	return [
		parseInt(digits.slice(0, 2), 16),
		parseInt(digits.slice(2, 4), 16),
		parseInt(digits.slice(4, 6), 16)
	];
}

function toHex(channels: Channels): string {
	const byte = (value: number) =>
		Math.round(Math.min(255, Math.max(0, value)))
			.toString(16)
			.padStart(2, '0');
	return `#${byte(channels[0])}${byte(channels[1])}${byte(channels[2])}`;
}

function relativeLuminance(hex: string): number {
	const [r, g, b] = toChannels(hex).map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	}) as Channels;
	return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
	const a = relativeLuminance(foreground);
	const b = relativeLuminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `share` of `color` blended into `into` — the sRGB equivalent of the web app's color-mix(). */
export function tint(color: string, into: string, share: number): string {
	const from = toChannels(color);
	const onto = toChannels(into);
	const blend = (a: number, b: number) => a * share + b * (1 - share);
	return toHex([blend(from[0], onto[0]), blend(from[1], onto[1]), blend(from[2], onto[2])]);
}

/** The foreground clearing WCAG AA on `background`, keeping `preferred` when it already does. */
export function contrastText(background: string, preferred: string): string {
	if (contrastRatio(preferred, background) >= MIN_CONTRAST) return preferred;
	if (contrastRatio('#ffffff', background) >= MIN_CONTRAST) return '#ffffff';
	return '#000000';
}
