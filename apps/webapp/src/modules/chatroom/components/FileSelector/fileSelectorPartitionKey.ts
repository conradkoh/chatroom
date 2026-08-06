// fallow-ignore-file unused-file unused-export
import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

const NO_WORKSPACE_SENTINEL = '__no_workspace__';

export function makeFileSelectorPartitionKey(
  chatroomId: string,
  machineId: string | null | undefined,
  workingDir: string | null | undefined
): string {
  const mid = machineId?.trim() || NO_WORKSPACE_SENTINEL;
  const wd =
    workingDir?.trim() ? normalizeWorkspaceWorkingDir(workingDir) : NO_WORKSPACE_SENTINEL;
  return `${chatroomId}:${mid}:${wd}`;
}

export { NO_WORKSPACE_SENTINEL };
