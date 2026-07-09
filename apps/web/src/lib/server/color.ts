function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return { r: 255, g: 255, b: 255 };
	const h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return { r, g, b };
}

function getLuminance(hex: string): number {
	const rgb = hexToRgb(hex);
	const a = [rgb.r, rgb.g, rgb.b].map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
	const fl = getLuminance(foreground);
	const bl = getLuminance(background);
	const lighter = Math.max(fl, bl);
	const darker = Math.min(fl, bl);
	return (lighter + 0.05) / (darker + 0.05);
}

const MIN_CONTRAST = 4.5;

export function getContrastText(primaryColor: string, textColor: string): string {
	const textRatio = contrastRatio(textColor, primaryColor);
	const whiteRatio = contrastRatio('#ffffff', primaryColor);

	if (textRatio >= MIN_CONTRAST) {
		return textColor;
	}
	if (whiteRatio >= MIN_CONTRAST) {
		return '#ffffff';
	}
	return '#000000';
}
