import { pendingOptimisticNewFilePaths } from '../hooks/pendingOptimisticNewFilePaths';

/** Daemon placeholder when workspace is not registered for the machine. */
const WORKSPACE_NOT_REGISTERED_PLACEHOLDER = '[Error: workspace not registered]';

/** Daemon placeholder when readFile fails for a non-transient reason. */
export const FILE_READ_ERROR_PLACEHOLDER = '[Error reading file]';

export function isPendingOptimisticNewFile(filePath: string): boolean {
  return pendingOptimisticNewFilePaths.has(filePath);
}

export function isTransientNewFileReadError(
  content: string | undefined,
  filePath: string
): boolean {
  return content === FILE_READ_ERROR_PLACEHOLDER && isPendingOptimisticNewFile(filePath);
}

export function isWorkspaceNotRegisteredError(content: string | undefined): boolean {
  return content === WORKSPACE_NOT_REGISTERED_PLACEHOLDER;
}
