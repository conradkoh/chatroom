type ActiveSource = { type: 'working-tree' } | { type: 'commit'; sha: string };

/** Build a stable source id for Cmd+I snippet attachments in git views. */
// fallow-ignore-next-line complexity
export function buildGitSelectionSource(
  activeSource: ActiveSource | null,
  context: 'file' | 'commit-message',
  filePath?: string
): string {
  if (!activeSource) return 'git:unknown';
  if (context === 'commit-message' && activeSource.type === 'commit') {
    return `git:commit:${activeSource.sha}`;
  }
  if (context === 'file' && filePath) {
    if (activeSource.type === 'working-tree') {
      return `git:working-tree:${filePath}`;
    }
    return `git:commit:${activeSource.sha}:${filePath}`;
  }
  return 'git:unknown';
}
