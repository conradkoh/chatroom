/**
 * OpenCode-Install Deps — dependency interfaces for the opencode-install command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/** File system operations for tool installation */
export interface OpenCodeInstallFsOps {
  access: (path: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  writeFile: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

/** Check if chatroom CLI is installed (injectable for tests) */
export type IsChatroomInstalled = () => Promise<boolean>;

/**
 * All external dependencies for the opencode-install command.
 *
 * - `backend`: Convex client (available for future use)
 * - `session`: Authentication and session retrieval (available for future use)
 * - `fs`: File system operations for writing tool files
 * - `isChatroomInstalled`: Check if chatroom CLI is available
 */
export interface OpenCodeInstallDeps {
  backend: BackendOps;
  session: SessionOps;
  fs: OpenCodeInstallFsOps;
  isChatroomInstalled: IsChatroomInstalled;
}
