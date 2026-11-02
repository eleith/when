import { configChanged, type WhenConfiguration } from '@when/config';
import { logger } from '../logger';

export interface ReloadEffects {
	swap: (config: WhenConfiguration) => void;
	restart: () => void;
}

// Auth (including its canonical URL) and DB/queue connections are built at boot.
const RESTART_KEYS: (keyof WhenConfiguration)[] = ['auth', 'database'];

export function applyConfig(
	next: WhenConfiguration,
	previous: WhenConfiguration,
	fx: ReloadEffects
): boolean {
	if (configChanged(previous, next, RESTART_KEYS) || previous.url.app !== next.url.app) {
		logger.warn('config change requires a restart');
		fx.restart();
		return false;
	}
	fx.swap(next);
	logger.info('config reloaded');
	return true;
}
