import type { MutationCtx, QueryCtx } from './_generated/server';

const MAX_FILE_PATH_LENGTH = 1024;
const MAX_DIR_PATH_LENGTH = 1024;

/** Validates an absolute working directory path, rejecting unsafe characters. */
// fallow-ignore-next-line complexity
export function validateWorkingDir(workingDir: string): void {
  if (!workingDir || workingDir.trim().length === 0) {
    throw new Error('Working directory cannot be empty');
  }

  const candidate = workingDir.trim();

  if (candidate.length > 1024) {
    throw new Error('Working directory path is too long (max 1024 characters)');
  }

  // Must be an absolute path
  if (!candidate.startsWith('/')) {
    throw new Error('Working directory must be an absolute path (starting with /)');
  }

  // Reject null bytes
  if (candidate.includes('\0')) {
    throw new Error('Working directory contains invalid characters (null byte)');
  }

  // Reject newlines / carriage returns
  if (/[\n\r]/.test(candidate)) {
    throw new Error('Working directory must not contain newlines');
  }

  // Reject shell metacharacters that could enable injection
  // These have no legitimate use in directory paths
  const shellMetaChars = /[;|&$`(){}<>!#~\\]/;
  if (shellMetaChars.test(candidate)) {
    throw new Error(
      'Working directory contains disallowed characters. ' +
        'Only alphanumeric characters, hyphens, underscores, dots, slashes, and spaces are allowed.'
    );
  }
}

/** Canonical workspace root path for registry keys and daemon requests. */
export function normalizeWorkingDir(workingDir: string): string {
  const trimmed = workingDir.trim();
  validateWorkingDir(trimmed);
  return trimmed.replace(/[/\\]+$/, '');
}

/**
 * Validate a file path for security.
 * Rejects path traversal, absolute paths, null bytes, and overly long paths.
 */
export function validateFilePath(filePath: string): void {
  if (filePath.length > MAX_FILE_PATH_LENGTH) {
    throw new Error('File path too long');
  }
  if (filePath.includes('..')) {
    throw new Error('Invalid file path: path traversal not allowed');
  }
  if (filePath.startsWith('/')) {
    throw new Error('Invalid file path: absolute paths not allowed');
  }
  if (filePath.includes('\0')) {
    throw new Error('Invalid file path: null bytes not allowed');
  }
}

export function validateDirPath(dirPath: string): void {
  if (dirPath.length > MAX_DIR_PATH_LENGTH) throw new Error('Directory path too long');
  if (dirPath.includes('..')) throw new Error('Invalid directory path');
  if (dirPath.startsWith('/')) throw new Error('Invalid directory path');
  if (dirPath.includes('\0')) throw new Error('Invalid directory path');
}

// fallow-ignore-next-line complexity
export async function requireRegisteredWorkspaceForMachine(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
): Promise<void> {
  const normalizedWorkingDir = normalizeWorkingDir(workingDir);
  let workspace = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', normalizedWorkingDir)
    )
    .first();

  if (!workspace && normalizedWorkingDir !== workingDir.trim()) {
    workspace = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', machineId).eq('workingDir', workingDir.trim())
      )
      .first();
  }

  if (!workspace || workspace.removedAt !== undefined) {
    throw new Error('Workspace not registered for this machine');
  }
}
