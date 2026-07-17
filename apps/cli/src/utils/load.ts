import { ConfigError, loadConfigFileStructure, type WhenConfiguration } from '@when/config';
import { fail, detail } from './report.ts';

export async function loadConfigStructural(configPath: string): Promise<WhenConfiguration | null> {
	try {
		return await loadConfigFileStructure(configPath);
	} catch (err) {
		if (err instanceof ConfigError) {
			fail('config is not valid — fix it first (when-cli config validate)');
			for (const issue of err.issues) detail(`${issue.path}: ${issue.message}`);
			return null;
		}
		throw err;
	}
}
