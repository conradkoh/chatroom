const NO_WORKSPACE_SENTINEL = '__no_workspace__';

export function makeCommandPalettePartitionKey(
  chatroomId: string,
  workspaceId: string | null | undefined
): string {
  const ws = workspaceId?.trim() || NO_WORKSPACE_SENTINEL;
  return `${chatroomId}:${ws}`;
}

export { NO_WORKSPACE_SENTINEL };
