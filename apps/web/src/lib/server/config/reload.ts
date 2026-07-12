import { configChanged, type ReloadResult, type WhenConfiguration } from '@when/config';
import { logger } from '../logger';

export interface ReloadEffects {
	current: () => WhenConfiguration;
	swap: (config: WhenConfiguration) => void;
	restart: () => void;
}

// Changes under these keys can't be hot-applied (auth providers and the DB/queue
// connections are built at boot), so a reboot picks them up instead.
const RESTART_KEYS: (keyof WhenConfiguration)[] = ['auth', 'database'];

export function applyConfig(result: ReloadResult, fx: ReloadEffects): void {
	if (!result.ok) {
		logger.error({ err: result.error }, 'config reload failed; keeping current config');
		return;
	}
	if (configChanged(fx.current(), result.config, RESTART_KEYS)) {
		logger.warn('config change requires a restart');
		fx.restart();
		return;
	}
	fx.swap(result.config);
	logger.info('config reloaded');
}
