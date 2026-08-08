import type { AssignedTaskSnapshotView } from '../../daemon/domain/entities/assigned-task.js';

let rows: AssignedTaskSnapshotView[] = [];
let hasSnapshot = false;
let snapshotProvider: (() => AssignedTaskSnapshotView[]) | undefined;

/** Point the snapshot store at an external source (e.g. P2 SQLite read models in cutover). */
export function setAssignedTaskSnapshotProvider(
  provider: (() => AssignedTaskSnapshotView[]) | undefined
): void {
  snapshotProvider = provider;
}

export function replaceAssignedTaskSnapshots(next: readonly AssignedTaskSnapshotView[]): void {
  rows = [...next];
  hasSnapshot = true;
}

export function clearAssignedTaskSnapshots(): void {
  rows = [];
  hasSnapshot = false;
}

export function hasAssignedTaskSnapshot(): boolean {
  if (snapshotProvider) return snapshotProvider().length > 0;
  return hasSnapshot;
}

export function listAssignedTaskSnapshots(): AssignedTaskSnapshotView[] {
  if (snapshotProvider) return snapshotProvider();
  return [...rows];
}

export function listAssignedTaskSnapshotsForRole(
  chatroomId: string,
  role: string
): AssignedTaskSnapshotView[] {
  const roleLower = role.toLowerCase();
  return rows.filter(
    (row) => row.chatroomId === chatroomId && row.agentConfig.role.toLowerCase() === roleLower
  );
}
