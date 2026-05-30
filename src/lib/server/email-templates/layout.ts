import { escapeHtml } from './escape';

export const DEFAULT_PRIMARY_COLOR = '#2563eb';

export interface BrandContext {
	/** Organizer display name. */
	name: string;
	/** Primary hex color, e.g. `#2563eb`. Optional — falls back to `DEFAULT_PRIMARY_COLOR`. */
	primaryColor?: string;
}

export interface WrapInput {
	brand: BrandContext;
	/** Body HTML — the variant renderer's output. Already escaped by the caller. */
	body: string;
	/** Optional extra footer HTML (e.g. action links). Rendered above the "Powered by When" line. */
	footer?: string;
}

/**
 * Owns the HTML email envelope: doctype, head, body wrapper, brand-color header strip, footer.
 * Inline CSS only — email clients ignore <style>. Variant renderers produce only `body`.
 */
export function wrap({ brand, body, footer }: WrapInput): string {
	const color = brand.primaryColor || DEFAULT_PRIMARY_COLOR;
	const colorAttr = escapeHtml(color);
	const name = escapeHtml(brand.name);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
<div style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
<div style="height:6px;background:${colorAttr};"></div>
<div style="padding:24px;font-size:15px;line-height:1.6;">
${body}
</div>
</div>
<div style="text-align:center;color:#6b7280;font-size:12px;line-height:1.6;padding:16px 0;">
${footer ? `${footer}<br>` : ''}${name} &middot; Powered by When
</div>
</div>
</body>
</html>`;
}
