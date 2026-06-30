import { define } from 'gunshi';

export const validateCommand = define({
	name: 'validate',
	description: 'Validate the config.yaml file',
	run(ctx) {
		const path = ctx.positionals[ctx.commandPath.length];
		console.log('Stub: validate config at path:', path);
	}
});
