import { configChanged, type ReloadResult, type WhenConfiguration } from '@when/config';
import type { WorkerContext } from './context.js';

// Changes under these keys can't be hot-applied (the mailer and DB/queue
// connections are built at boot), so a reboot picks them up instead.
const RESTART_KEYS: (keyof WhenConfiguration)[] = ['smtp', 'database'];

export function applyConfig(result: ReloadResult, ctx: WorkerContext, onRestart: () => void): void {
	if (!result.ok) {
		ctx.logger.error({ err: result.error }, 'config reload failed; keeping current config');
		return;
	}
	if (configChanged(ctx.config, result.config, RESTART_KEYS)) {
		ctx.logger.warn('config change requires a restart');
		onRestart();
		return;
	}
	ctx.config = result.config;
	ctx.logger.info('config reloaded');
}
