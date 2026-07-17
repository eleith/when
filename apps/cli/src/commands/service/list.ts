import type { Service } from '@when/config';

export function runServiceList(services: Service[]): void {
	if (services.length === 0) {
		console.log('No services configured.');
		return;
	}
	for (const s of services) {
		console.log(`${s.name}  (${s.type})`);
	}
}
