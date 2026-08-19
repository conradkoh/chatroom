import type { AssignedTaskSnapshotView } from '../../daemon/domain/entities/assigned-task.js';

let rows: AssignedTaskSnapshotView[] = [];
let hasSnapshot = false;

export function replaceAssignedTaskSnapshots(next: readonly AssignedTaskSnapshotView[]): void {
  rows = [...next];
  hasSnapshot = true;
}
function sameTaskRole(row: AssignedTaskSnapshotView, taskId: string, role: string): boolean {
  return row.taskId === taskId && row.agentConfig.role.toLowerCase() === role.toLowerCase();
}
export function upsertAssignedTaskSnapshot(row: AssignedTaskSnapshotView): void {
  const idx = rows.findIndex((existing) =>
    sameTaskRole(existing, row.taskId, row.agentConfig.role)
  );
  rows = idx === -1 ? [...rows, row] : rows.map((existing, i) => (i === idx ? row : existing));
  hasSnapshot = true;
}
export function removeAssignedTaskSnapshot(taskId: string, role: string): void {
  rows = rows.filter((row) => !sameTaskRole(row, taskId, role));
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
