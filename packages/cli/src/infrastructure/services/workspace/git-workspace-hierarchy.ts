export interface GitRepoNode {
  workTree: string;
  gitDir: string;
  relativePath: string;
  pathspec: string[];
  children: GitRepoNode[];
}

export interface GitWorkspaceHierarchy {
  workspaceRoot: string;
  root: GitRepoNode;
}

export async function discoverGitWorkspaceHierarchy(
  _workingDir: string
): Promise<GitWorkspaceHierarchy | null> {
  return null;
}
