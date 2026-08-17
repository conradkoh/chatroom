export type PendingConvexId = string | { toString(): string };
export interface PendingRowWithId {
  _id: PendingConvexId;
}
export function pendingConvexId(req: PendingRowWithId): string {
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

function pruneStaleSnapshotIds(last: Map<string, string>, requests: PendingRowWithId[]): void {
  const active = new Set(requests.map(pendingConvexId));
  for (const id of last.keys()) {
    if (!active.has(id)) last.delete(id);
  }
}

// fallow-ignore-next-line complexity
export function drainPendingRequestSnapshotDedup<T extends PendingRowWithId>(
  requests: T[] | null,
  last: Map<string, string>,
  getSnapshot: (req: T) => string
): string[] {
  if (!requests?.length) {
    last.clear();
    return [];
  }
  const emitted: string[] = [];
  for (const req of requests) {
    const id = pendingConvexId(req);
    const snapshot = getSnapshot(req);
    if (last.get(id) !== snapshot) {
      last.set(id, snapshot);
      emitted.push(id);
    }
  }
  pruneStaleSnapshotIds(last, requests);
  return emitted;
}
