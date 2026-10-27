/**
 * Default deps for `chatroom remove-image-background-fal`.
 *
 * This is the only module in the command's path that creates the fal adapter.
 * The filesystem half is reused from `slice-deps.ts`, which is fal-free, so the
 * command only pays for the SDK it actually calls.
 */

import { dirname } from 'node:path';

import { createFalRawSubscribe } from './deps.js';
import { createDefaultFalPricingDeps, lookupFalUnitPrices } from './fal-pricing.js';
import { MAX_FAL_RESULT_BYTES, type RemoveBackgroundFalDeps } from './remove-background-fal.js';
import { createDefaultSliceImageDeps } from './slice-deps.js';
import { readInstalledPackageVersion } from '../image-shared/package-version.js';

function mebibytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** Reject from the `content-length` header before the body is buffered. */
function requireDeclaredSize(declared: string | null, maxBytes: number): void {
  if (declared === null) return;
  const size = Number(declared);
  if (!Number.isFinite(size) || size <= maxBytes) return;
  throw new Error(
    `Downloaded image is ${size} bytes; the maximum is ${maxBytes} bytes (${mebibytes(maxBytes)} MiB).`
  );
}

function requireImageContentType(response: Response): void {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().startsWith('image/')) return;
  throw new Error(
    `Downloaded file is not an image (HTTP ${response.status}, content-type: ${contentType || 'missing'})`
  );
}

/**
 * Download the cut-out, rejecting an oversized body from `content-length`
 * before buffering it. `generate-image`'s `fetchBytes` is unchanged; this
 * wrapper exists because the BiRefNet result is downloaded by this command.
 */
async function fetchCappedBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (HTTP ${response.status} ${response.statusText})`);
  }
  requireDeclaredSize(response.headers.get('content-length'), maxBytes);
  requireImageContentType(response);
  return new Uint8Array(await response.arrayBuffer());
}

export function createDefaultRemoveBackgroundFalDeps(): RemoveBackgroundFalDeps {
  const slice = createDefaultSliceImageDeps();
  const pricingDeps = createDefaultFalPricingDeps(process.env);
  return {
    env: process.env,
    falSubscribe: createFalRawSubscribe(process.env),
    lookupPrices: (ids) => lookupFalUnitPrices(ids, pricingDeps),
    fetchBytes: (url) => fetchCappedBytes(url, MAX_FAL_RESULT_BYTES),
    readInput: slice.readFile,
    statInput: slice.statInput,
    pathStatus: slice.pathStatus,
    writeFile: slice.writeFile,
    writeJson: slice.writeJson,
    ensureParentDir: (path) => slice.ensureDir(dirname(path)),
    now: () => new Date(),
    sdkVersion: readInstalledPackageVersion('@fal-ai/client'),
    log: (message) => console.log(message),
  };
}
