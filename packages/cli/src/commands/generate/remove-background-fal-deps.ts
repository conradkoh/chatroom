/**
 * Default deps for `chatroom remove-image-background-fal`.
 *
 * This is the only module in the command's path that creates the fal adapter.
 * The filesystem half is reused from `slice-deps.ts`, which is fal-free, so the
 * command only pays for the SDK it actually calls.
 */

import { dirname } from 'node:path';

import { createFalRawSubscribe, fetchBytes } from './deps.js';
import { readInstalledPackageVersion } from './package-version.js';
import type { RemoveBackgroundFalDeps } from './remove-background-fal.js';
import { createDefaultSliceImageDeps } from './slice-deps.js';

export function createDefaultRemoveBackgroundFalDeps(): RemoveBackgroundFalDeps {
  const slice = createDefaultSliceImageDeps();
  return {
    env: process.env,
    falSubscribe: createFalRawSubscribe(process.env),
    fetchBytes,
    readInput: slice.readFile,
    statInput: slice.statInput,
    pathStatus: slice.pathStatus,
    writeFile: slice.writeFile,
    writeJson: slice.writeJson,
    ensureParentDir: (path) => slice.ensureDir(dirname(path)),
    now: () => new Date(),
    sdkVersion: readInstalledPackageVersion('@fal-ai/client'),
  };
}
