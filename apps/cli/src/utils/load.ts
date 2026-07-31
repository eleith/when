import {
	ConfigError,
	MissingEnvVarsError,
	loadConfigFile,
	type WhenConfiguration
} from '@when/config';
import { fail, detail } from './report.ts';

/**
 * The config as the app itself sees it: `${VAR}` refs interpolated and database paths
 * resolved. Web and the worker refuse to boot until every var is set, so a CLI that
 * reports on their state holds the same bar — and names the vars that are missing.
 *
 * `config validate` is the exception: answering "is this well-formed?" without the
 * environment is its whole purpose, so it reaches for the structural loader itself.
 */
export async function loadConfigFully(configPath: string): Promise<WhenConfiguration | null> {
	try {
		return await loadConfigFile(configPath);
	} catch (err) {
		if (err instanceof ConfigError) {
			fail('config is not valid — fix it first (when-cli config validate)');
			for (const issue of err.issues) detail(`${issue.path}: ${issue.message}`);
			return null;
		}
		if (err instanceof MissingEnvVarsError) {
			fail('config references environment variables that are not set');
			for (const name of err.missing) detail(name);
			return null;
		}
		throw err;
	}
}
