/**
 * Locates the local stack's backup directory.
 *
 * Pure resolution with injected `env`, `cwd` and `exists`. The directory is only ever named, never
 * created: a missing stack resolves to `null` and the caller reports "no stack found".
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { USER_BACKUPS_DIR_RELATIVE } from '@workspace/shared/domain/machine-backup';

export interface ResolveUserBackupsDirArgs {
  env: Record<string, string | undefined>;
  cwd: string;
  exists: (path: string) => boolean;
}

/**
 * Backup directory of the local stack, or null when no stack is found.
 * Root = CHATROOM_REPO_ROOT when set, otherwise the nearest ancestor of cwd containing
 * pnpm-workspace.yaml. The stack must exist (services/backend). Never creates anything.
 */
// Exported for the directory-resolution tests; production wiring reaches it through the helper below.
// fallow-ignore-next-line unused-export
export function resolveUserBackupsDir(args: ResolveUserBackupsDirArgs): string | null {
  const root = args.env.CHATROOM_REPO_ROOT || findWorkspaceRoot(resolve(args.cwd), args.exists);
  if (!root || !args.exists(join(root, 'services/backend'))) return null;
  return join(root, USER_BACKUPS_DIR_RELATIVE);
}

function findWorkspaceRoot(start: string, exists: (path: string) => boolean): string | null {
  let dir = start;
  for (;;) {
    if (exists(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Production wiring: real env, cwd and `existsSync`. */
export function resolveUserBackupsDirFromProcess(): string | null {
  return resolveUserBackupsDir({ env: process.env, cwd: process.cwd(), exists: existsSync });
}
