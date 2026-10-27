/**
 * Dependency boundary for `chatroom remove-image-background`.
 *
 * The command reuses the slicer's pngjs-backed adapter, which is already
 * fal-free, and adds directory listing for batch mode. It must never import
 * `./deps.js` or `@fal-ai/client`.
 */

import { readdir } from 'node:fs/promises';

import { createDefaultSliceImageDeps, type SliceImageDeps } from '../slice-image/slice-deps.js';

export interface RemoveImageBackgroundDeps extends SliceImageDeps {
  listDir: (dir: string) => Promise<string[]>;
}

export function createDefaultRemoveImageBackgroundDeps(): RemoveImageBackgroundDeps {
  return {
    ...createDefaultSliceImageDeps(),
    listDir: (dir) => readdir(dir),
  };
}
