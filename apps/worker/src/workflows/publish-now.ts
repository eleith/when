import { getOpenWorkflow, publishNow, type PublishNowResult } from '@when/jobs';
import type { PublishScanner } from '../calendar/publish-scanner.js';

export function registerPublishNowWorkflow(scanner: PublishScanner): void {
	getOpenWorkflow().implementWorkflow(publishNow, (): PublishNowResult => {
		scanner.requestScan();
		return 'requested';
	});
}
