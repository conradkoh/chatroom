/**
 * Init File System Service — Effect Context.Tag for init command fs operations.
 *
 * This service provides file system operations specific to the init command.
 */

import { Context, type Effect } from 'effect';

// ─── Service Interface ─────────────────────────────────────────────────────

export interface InitFsServiceShape {
  /** Returns true if path is accessible, false if not (no error thrown) */
  access: (path: string) => Effect.Effect<boolean>;
  readFile: (path: string, encoding: string) => Effect.Effect<string, Error>;
  writeFile: (path: string, content: string, encoding: string) => Effect.Effect<void, Error>;
}

// ─── Service Tag ───────────────────────────────────────────────────────────

export class InitFsService extends Context.Tag('InitFsService')<
  InitFsService,
  InitFsServiceShape
>() {}
