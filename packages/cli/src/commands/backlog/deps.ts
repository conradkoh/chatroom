/**
 * Backlog Deps — dependency interfaces for the backlog commands.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/** File system operations needed by backlog export/import commands */
export interface BacklogFsOps {
  /** Write content to a file */
  writeFile: (path: string, data: string) => Promise<void>;
  /** Read content from a file */
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  /** Create a directory, optionally recursive */
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<string | undefined>;
}

export interface BacklogDeps {
  backend: BackendOps;
  session: SessionOps;
  fs?: BacklogFsOps;
}
