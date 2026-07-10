export type PathDiff = {
  added: string[];
  removed: string[];
  /** Path exists in both but type changed (file ↔ directory). */
  typeChanged: string[];
};

// fallow-ignore-next-line complexity
export function diffPathIndexes(
  previous: Record<string, 'file' | 'directory'> | undefined,
  next: Record<string, 'file' | 'directory'>
): PathDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const typeChanged: string[] = [];

  const prev = previous ?? {};

  for (const [path, type] of Object.entries(next)) {
    if (!(path in prev)) {
      added.push(path);
    } else if (prev[path] !== type) {
      typeChanged.push(path);
    }
  }

  for (const path of Object.keys(prev)) {
    if (!(path in next)) {
      removed.push(path);
    }
  }

  added.sort();
  removed.sort();
  typeChanged.sort();

  return { added, removed, typeChanged };
}

export function formatPathDiffSummary(diff: PathDiff): string {
  return `+${diff.added.length} added, -${diff.removed.length} removed${
    diff.typeChanged.length > 0 ? `, ~${diff.typeChanged.length} type-changed` : ''
  }`;
}
