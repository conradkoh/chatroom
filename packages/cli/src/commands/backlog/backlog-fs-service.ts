/**
 * BacklogFsService — Effect Context.Tag for filesystem operations needed by
 * the backlog export/import commands.
 */

import * as nodeFs from 'node:fs/promises';

import { Context, Effect, Layer } from 'effect';

import type { BacklogFsOps } from './deps.js';

// ─── Service shape ──────────────────────────────────────────────────────────

export interface BacklogFsServiceShape {
  writeFile: (path: string, data: string) => Effect.Effect<void, Error>;
  readFile: (path: string, encoding: BufferEncoding) => Effect.Effect<string, Error>;
  mkdir: (
    path: string,
    options?: { recursive?: boolean }
  ) => Effect.Effect<string | undefined, Error>;
}

export class BacklogFsService extends Context.Tag('BacklogFsService')<
  BacklogFsService,
  BacklogFsServiceShape
>() {}

// ─── Live Layer (real fs) ───────────────────────────────────────────────────

export const BacklogFsServiceLive: Layer.Layer<BacklogFsService> = Layer.succeed(BacklogFsService, {
  writeFile: (path, data) =>
    Effect.tryPromise({
      try: () => nodeFs.writeFile(path, data, 'utf-8'),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
  readFile: (path, enc) =>
    Effect.tryPromise({
      try: () => nodeFs.readFile(path, { encoding: enc }) as Promise<string>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
  mkdir: (path, opts) =>
    Effect.tryPromise({
      try: () => nodeFs.mkdir(path, opts) as Promise<string | undefined>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
});

// ─── Layer from BacklogFsOps (for testing / legacy deps injection) ──────────

export const BacklogFsServiceFrom = (ops: BacklogFsOps): Layer.Layer<BacklogFsService> =>
  Layer.succeed(BacklogFsService, {
    writeFile: (path, data) =>
      Effect.tryPromise({
        try: () => ops.writeFile(path, data),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    readFile: (path, enc) =>
      Effect.tryPromise({
        try: () => ops.readFile(path, enc),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    mkdir: (path, opts) =>
      Effect.tryPromise({
        try: () => ops.mkdir(path, opts),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
  });
