import type { WhenConfiguration } from '@when/config';
import type { ConnectedService } from '@when/calendar';

// A google service's refresh token is stored outside when.yaml; this is where the two
// halves meet.
export function connectedServices(config: WhenConfiguration): ConnectedService[] {
	return (config.services ?? []).map((service) =>
		service.type === 'google' ? { ...service, refresh_token: service.refresh_token } : service
	);
}
