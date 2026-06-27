export function makeHarnessKey(workspaceId: string, harnessName: string): string {
  return `${workspaceId}:${harnessName}`;
}

export function parseHarnessKey(key: string): { workspaceId: string; harnessName: string } {
  const idx = key.indexOf(':');
  if (idx === -1) throw new Error(`Invalid harness key: ${key}`);
  return { workspaceId: key.slice(0, idx), harnessName: key.slice(idx + 1) };
}
