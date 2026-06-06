/**
 * Block accidental `npm publish` from the pnpm workspace tree.
 *
 * Registered as `prepublishOnly` in packages/cli/package.json. npm runs that hook
 * before pack/publish — including when someone runs `npm publish` from packages/cli
 * inside the monorepo.
 *
 * Publishing from the workspace is unsafe because:
 * - `devDependencies` use `workspace:*` (npm cannot install them)
 * - `prepublishOnly` would otherwise invoke `pnpm build` against the wrong tree
 * - `npm pack` would traverse pnpm symlinks and produce broken tarballs
 *
 * Allowed paths:
 * - CI: build/test in monorepo → `publish:prepare` → publish from `.npm-publish/`
 * - Local: same, after `pnpm --filter chatroom-cli publish:prepare`
 *
 * The `.publish-ready` marker is written by prepare-npm-publish.ts so a subsequent
 * publish attempt from the workspace (if any) does not trip the guard after staging.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { cliRoot } from './publish-common.js';

const stagingMarker = join(cliRoot, '.npm-publish', '.publish-ready');

if (process.env.PUBLISH_FROM_STAGING === '1' || existsSync(stagingMarker)) {
  process.exit(0);
}

console.error(
  [
    'Refusing to publish chatroom-cli from the pnpm workspace.',
    '',
    'Use the publish staging pipeline instead:',
    '  pnpm --filter chatroom-cli publish:prepare',
    '  pnpm --filter chatroom-cli publish:verify',
    '  npm publish --access public --ignore-scripts',
    '    (from packages/cli/.npm-publish)',
    '',
    'CI runs the same steps via .github/workflows/publish-cli.yml.',
  ].join('\n')
);
process.exit(1);
