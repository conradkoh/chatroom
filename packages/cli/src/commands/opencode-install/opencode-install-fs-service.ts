/**
 * OpenCodeInstallFsService — Effect Context.Tag for opencode-install command operations.
 *
 * This service provides file system operations and CLI detection specific
 * to the opencode-install command.
 */

import { Context, type Effect } from 'effect';

// ─── Service Interface ─────────────────────────────────────────────────────

export interface OpenCodeInstallFsServiceShape {
  /** Returns true if path is accessible, false if not (no error thrown) */
  access: (path: string) => Effect.Effect<boolean>;
  /** Creates a directory (recursive by default) */
  mkdir: (path: string, options: { recursive: boolean }) => Effect.Effect<void, Error>;
  /** Writes content to a file */
  writeFile: (path: string, content: string, encoding: string) => Effect.Effect<void, Error>;
  /** Returns true if the chatroom CLI is installed on the system */
  isChatroomInstalled: () => Effect.Effect<boolean>;
}

// ─── Service Tag ───────────────────────────────────────────────────────────

export class OpenCodeInstallFsService extends Context.Tag('OpenCodeInstallFsService')<
  OpenCodeInstallFsService,
  OpenCodeInstallFsServiceShape
>() {}
