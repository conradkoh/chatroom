import 'server-only';

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBAPP_PACKAGE_JSON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../package.json'
);

const require = createRequire(WEBAPP_PACKAGE_JSON);

/** Resolves the installed mermaid.min.js UMD bundle via the webapp package dependency graph. */
export function resolveMermaidMinPath(): string {
  return require.resolve('mermaid/dist/mermaid.min.js');
}
