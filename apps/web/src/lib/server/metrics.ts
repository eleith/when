import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

export const register = new Registry();
register.setDefaultLabels({ app: 'when' });

collectDefaultMetrics({ register });

export const configValid = new Gauge({
	name: 'when_config_valid',
	help: 'Whether config.yaml loaded and validated successfully (1) or not (0).',
	registers: [register]
});

configValid.set(0);
