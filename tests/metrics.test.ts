import { expect, test } from 'bun:test';
import { register } from '../src/lib/server/metrics';

test('metrics registry exposes when_config_valid', async () => {
	const text = await register.metrics();
	expect(text).toContain('when_config_valid');
	expect(text).toMatch(/when_config_valid\{app="when"\} [01]/);
});
