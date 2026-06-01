import { ConfigError, loadConfigFile } from '@when/config';
import { MissingEnvVarsError } from '@when/config';

const path = process.argv[2] ?? './config.yaml';

try {
	const cfg = await loadConfigFile(path);
	console.log(`OK  ${path}`);
	console.log(`    auth: ${'oidc' in cfg.auth ? 'oidc' : 'credentials'}`);
	console.log(`    calendars: ${cfg.calendars.length}`);
	console.log(`    event_types: ${cfg.event_types.length}`);
	process.exit(0);
} catch (err) {
	if (err instanceof ConfigError) {
		console.error(`FAIL  ${path}`);
		for (const issue of err.issues) {
			console.error(`      ${issue.path}: ${issue.message}`);
		}
	} else if (err instanceof MissingEnvVarsError) {
		console.error(`FAIL  ${path}`);
		console.error(`      missing env vars: ${err.missing.join(', ')}`);
	} else {
		console.error(`FAIL  ${path}`);
		console.error(`      ${err instanceof Error ? err.message : String(err)}`);
	}
	process.exit(1);
}
