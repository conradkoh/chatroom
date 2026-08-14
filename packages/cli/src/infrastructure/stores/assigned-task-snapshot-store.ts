import type { AssignedTaskSnapshotView } from '../../daemon/domain/entities/assigned-task.js';

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

function snapshotKey(row: AssignedTaskSnapshotView): string {
  return `${row.taskId}:${row.agentConfig.role}`;
}

export function upsertAssignedTaskSnapshot(row: AssignedTaskSnapshotView): void {
  const key = snapshotKey(row);
  const index = rows.findIndex((existing) => snapshotKey(existing) === key);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  hasSnapshot = true;
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
