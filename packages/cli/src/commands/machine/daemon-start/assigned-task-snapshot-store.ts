import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

let rows: AssignedTaskSnapshotView[] = [];
let hasSnapshot = false;

export function replaceAssignedTaskSnapshots(next: readonly AssignedTaskSnapshotView[]): void {
  rows = [...next];
  hasSnapshot = true;
}

export function clearAssignedTaskSnapshots(): void {
  rows = [];
  hasSnapshot = false;
}

export function hasAssignedTaskSnapshot(): boolean {
  return hasSnapshot;
}

export function listAssignedTaskSnapshots(): AssignedTaskSnapshotView[] {
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
