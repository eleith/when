import { describe, expect, test } from 'vitest';
import { compileMjml } from './mjml.js';

describe('compileMjml', () => {
	test('compiles valid MJML to email HTML', async () => {
		const html = await compileMjml(
			'<mjml><mj-body><mj-section><mj-column><mj-text>hi there</mj-text></mj-column></mj-section></mj-body></mjml>'
		);
		expect(html).toContain('hi there');
		expect(html.toLowerCase()).toContain('<!doctype html');
	});

	test('throws on invalid MJML', async () => {
		await expect(compileMjml('<mjml><mj-body><mj-bogus-tag /></mj-body></mjml>')).rejects.toThrow(
			/MJML compile errors/
		);
	});
});
