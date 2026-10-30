import type { WhenSession } from '#lib/server/auth/index.js';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth: () => Promise<WhenSession | null>;
		}
		interface PageData {
			session?: WhenSession | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '*.yaml?raw' {
	const content: string;
	export default content;
}

export {};
