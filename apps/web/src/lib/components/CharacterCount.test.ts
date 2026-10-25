import { describe, expect, test } from 'vitest';
import { render } from 'svelte/server';
import CharacterCount from './CharacterCount.svelte';

describe('CharacterCount', () => {
	test.each([
		['', 500, '0/500'],
		['A note', 500, '6/500'],
		['A note', 1000, '6/1000'],
		['😀', 500, '2/500']
	])('renders the existing character-count format for %j', (value, limit, count) => {
		const rendered = render(CharacterCount, {
			props: { value: String(value), limit: Number(limit) }
		});
		expect(rendered.body).toContain(String(count));
	});
});
