import type { ServiceStatus } from '@when/db';

export type ObservedState = 'working' | 'failing' | 'unobserved';

export interface ObservedView {
	state: ObservedState;
	at: string | null;
	via: string | null;
	error: string | null;
}

export function observedFrom(status: ServiceStatus | undefined): ObservedView {
	if (!status) return { state: 'unobserved', at: null, via: null, error: null };
	if (status.error) {
		return { state: 'failing', at: status.failing_since, via: status.via, error: status.error };
	}
	return { state: 'working', at: status.last_ok_at, via: status.via, error: null };
}
