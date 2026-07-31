import type { WhenConfiguration } from '@when/config';
import { connectService, type ConnectedService } from '@when/calendar';
import { getServiceRefreshToken, type openDb } from '@when/db';

// A google service's refresh token is stored outside when.yaml; this is where the two
// halves meet.
export async function connectedServices(
	config: WhenConfiguration,
	db: ReturnType<typeof openDb>
): Promise<ConnectedService[]> {
	const services = config.services ?? [];
	return Promise.all(
		services.map(async (service) =>
			connectService(service, await getServiceRefreshToken(db, service.name))
		)
	);
}
