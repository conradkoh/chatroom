/**
 * Shared filesystem helpers for local asset commands.
 *
 * Both `generate-image` and `slice-image` classify paths and write image or
 * JSON files the same way. This module must not import `@fal-ai/client`, so
 * slicing can reuse it without loading the fal SDK.
 */

import { stat, writeFile } from 'node:fs/promises';

export type PathStatus = 'missing' | 'file' | 'directory';

/** Options for the write helpers. `exclusive` uses the `wx` flag. */
export interface WriteOptions {
  exclusive?: boolean | undefined;
}

/** Classify a path without creating it; anything that is not a dir counts as a file. */
export async function pathStatus(path: string): Promise<PathStatus> {
  try {
    const stats = await stat(path);
    return stats.isDirectory() ? 'directory' : 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw err;
  }
}

export async function writeFileBytes(
  path: string,
  bytes: Uint8Array,
  options: WriteOptions = {}
): Promise<void> {
  if (options.exclusive === true) {
    await writeFile(path, bytes, { flag: 'wx' });
    return;
  }
  await writeFile(path, bytes);
}

export async function writeJsonFile(
  path: string,
  value: unknown,
  options: WriteOptions = {}
): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (options.exclusive === true) {
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  await writeFile(path, text, 'utf8');
}
