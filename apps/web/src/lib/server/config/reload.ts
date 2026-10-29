import { configChanged, type ReloadResult, type WhenConfiguration } from '@when/config';
import { logger } from '../logger';

export interface ReloadEffects {
	current: () => WhenConfiguration;
	swap: (config: WhenConfiguration) => void;
	restart: () => void;
}

// Auth (including its canonical URL) and DB/queue connections are built at boot.
const RESTART_KEYS: (keyof WhenConfiguration)[] = ['auth', 'database'];

export function applyConfig(result: ReloadResult, fx: ReloadEffects): void {
	if (!result.ok) {
		logger.error({ err: result.error }, 'config reload failed; keeping current config');
		return;
	}
	const current = fx.current();
	if (
		configChanged(current, result.config, RESTART_KEYS) ||
		current.url.app !== result.config.url.app
	) {
		logger.warn('config change requires a restart');
		fx.restart();
		return;
	}
	fx.swap(result.config);
	logger.info('config reloaded');
}
