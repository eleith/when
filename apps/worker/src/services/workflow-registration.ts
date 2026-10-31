import { getOpenWorkflow, type WorkflowSpec } from '@when/jobs';
import type { Workflow } from 'openworkflow';
import { observeWorkflow } from '../metrics/workflows.js';

/** Public registration boundary for worker workflow handlers. */
export function implementWorkflow<I, R>(
	spec: WorkflowSpec<I, R>,
	handler: Workflow<I, R, I>['fn']
): void {
	getOpenWorkflow().implementWorkflow(spec, observeWorkflow(spec, handler));
}
