// fallow-ignore-file complexity

import type { CompactFileTreeDeltaOp } from '../lib/fileTreeDeltaOps';
import { validateFilePath } from '../workspacePathSecurity';

export function validateFileTreeRevision(revision: number, field: string): void {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error(`${field} must be a non-negative safe integer`);
}
export function validateOperationId(id: string) {
  if (!id || id.length > MAX_OPERATION_ID_LENGTH)
    throw new Error(`operationId must be between 1 and ${MAX_OPERATION_ID_LENGTH} characters`);
}
export function validateDeltaBatch(ops: CompactFileTreeDeltaOp[]) {
  if (ops.length === 0 || ops.length > MAX_FILE_TREE_DELTA_OPERATIONS)
    throw new Error(
      `Delta batch must contain between 1 and ${MAX_FILE_TREE_DELTA_OPERATIONS} operations`
    );
  if (new TextEncoder().encode(JSON.stringify(ops)).length > MAX_FILE_TREE_DELTA_BYTES)
    throw new Error('File tree delta batch too large');
  for (const op of ops) {
    validateFilePath(op.p);
    if (op.o === 'r' && ('e' in op || 's' in op || 'm' in op))
      throw new Error('Remove operations must contain only a path');
  }
}

export const MAX_FILE_TREE_DELTA_OPERATIONS = 500;
export const MAX_FILE_TREE_DELTA_BYTES = 800 * 1024;
export const MAX_FILE_TREE_DELTAS_PER_QUERY = 100;
export const MAX_OPERATION_ID_LENGTH = 200;
