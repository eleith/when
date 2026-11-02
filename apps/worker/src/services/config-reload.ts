import { configChanged, type WhenConfiguration } from '@when/config';
import type { WorkerContext } from './context.js';

// Changes under these keys can't be hot-applied (the mailer and DB/queue
// connections are built at boot), so a reboot picks them up instead.
const RESTART_KEYS: (keyof WhenConfiguration)[] = ['smtp', 'database'];

export function applyConfig(
	next: WhenConfiguration,
	previous: WhenConfiguration,
	ctx: WorkerContext,
	onRestart: () => void
): boolean {
	if (configChanged(previous, next, RESTART_KEYS)) {
		ctx.logger.warn('config change requires a restart');
		onRestart();
		return false;
	}
	ctx.config = next;
	ctx.logger.info('config reloaded');
	return true;
}
