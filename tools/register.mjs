// Registers the dev-only TypeScript resolve hook (tools/hooks.mjs) on Node's
// module loader. Load it before an entrypoint with `--import`, e.g.
//
//   node --conditions=development --watch --import ./tools/register.mjs apps/worker/src/index.ts
//
// The '--conditions=development' flag makes Node pick each @when/* package's
// "development" export (its src/index.ts); this hook then remaps the '.js'
// specifiers inside that source to '.ts'. Prod uses neither — it runs dist/.
import { registerHooks } from 'node:module';
import { resolve } from './hooks.mjs';

registerHooks({ resolve });
