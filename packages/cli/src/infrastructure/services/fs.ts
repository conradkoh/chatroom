/**
 * FsService — Effect-TS service definition for filesystem operations.
 *
 * Wraps FsOps in an Effect Context.Tag for dependency injection via Layers.
 * Phase 1: Define service interface; existing FsOps consumers unchanged until Phase 2+.
 */

import type { Stats } from 'node:fs';
import * as fs from 'node:fs/promises';

import { Context, Effect, Layer } from 'effect';

export interface FsServiceShape {
  /** Get file/directory stats (wraps fs.stat) */
  stat: (path: string) => Effect.Effect<Stats, Error>;
}

export class FsService extends Context.Tag('FsService')<FsService, FsServiceShape>() {}

/**
 * Live Layer — uses real node:fs/promises.
 */
export const FsServiceLive: Layer.Layer<FsService> = Layer.succeed(FsService, {
  stat: (path) =>
    Effect.tryPromise({
      try: () => fs.stat(path),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
});
