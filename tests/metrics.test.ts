import { expect, test } from 'bun:test';
import { configValid, register } from '../src/lib/server/metrics';

test('configValid gauge starts at 0', async () => {
	const json = await register.getMetricsAsJSON();
	const gauge = json.find((m) => m.name === 'when_config_valid');
	expect(gauge).toBeDefined();
	const { values } = gauge as unknown as { values: Array<{ value: number }> };
	expect(values[0].value).toBe(0);
});

test('register has default labels', async () => {
	const json = await register.getMetricsAsJSON();
	const gauge = json.find((m) => m.name === 'when_config_valid');
	expect(gauge).toBeDefined();
	const { values } = gauge as unknown as { values: Array<{ labels: Record<string, string> }> };
	expect(values[0].labels).toHaveProperty('app', 'when');
});

test('configValid can be set to 1', async () => {
	configValid.set(1);
	const json = await register.getMetricsAsJSON();
	const gauge = json.find((m) => m.name === 'when_config_valid');
	expect(gauge).toBeDefined();
	const { values } = gauge as unknown as { values: Array<{ value: number }> };
	expect(values[0].value).toBe(1);
	configValid.set(0);
});
