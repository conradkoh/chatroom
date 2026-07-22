export const WORKSPACE_COMMAND_ACTIONS = [
  'open-github-desktop',
  'open-vscode',
  'view-github-prs',
  'view-current-pr',
  'review-prs',
  'view-repo',
  'git-diff',
  'git-pull',
  'workspace-details',
] as const;

export type WorkspaceCommandAction = (typeof WORKSPACE_COMMAND_ACTIONS)[number];

export function workspaceCommandBlacklistKey(action: WorkspaceCommandAction): string {
  return `ws-${action}`;
}

export function parseWorkspaceCommandBlacklistKeyFromId(id: string): string | null {
  if (!id.startsWith('ws-')) return null;

  if (WORKSPACE_COMMAND_ACTIONS.some((a) => id === `ws-${a}`)) {
    return id;
  }

  const sorted = [...WORKSPACE_COMMAND_ACTIONS].sort((a, b) => b.length - a.length);
  for (const action of sorted) {
    if (id.endsWith(`-${action}`)) return `ws-${action}`;
  }

  return null;
}
