// Drops the fixture databases so each Playwright run starts from a freshly
// migrated schema — the app recreates and migrates them at boot.
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await rm(fileURLToPath(new URL('./fixture/data', import.meta.url)), {
	recursive: true,
	force: true
});
