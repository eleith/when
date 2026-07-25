// The app recreates and migrates the databases at boot.
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await rm(fileURLToPath(new URL('./fixture/data', import.meta.url)), {
	recursive: true,
	force: true
});
