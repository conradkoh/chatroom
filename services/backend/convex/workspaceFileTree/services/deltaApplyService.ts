import type { MutationCtx } from '../../_generated/server';
import type { CompactFileTreeDeltaOp } from '../../lib/fileTreeDeltaOps';
import * as d from '../repositories/deltaRepository';
import { validateDeltaBatch, validateFileTreeRevision, validateOperationId } from '../validation';

export async function applyFileTreeDeltaBatch(
  ctx: MutationCtx,
  a: {
    machineId: string;
    workingDir: string;
    operationId: string;
    baseRevision: number;
    operations: CompactFileTreeDeltaOp[];
  }
) {
  validateFileTreeRevision(a.baseRevision, 'baseRevision');
  validateOperationId(a.operationId);
  validateDeltaBatch(a.operations);
  const receipt = await d.findOperationReceipt(ctx, a.machineId, a.workingDir, a.operationId);
  if (receipt) return { status: 'duplicate' as const, revision: receipt.revision };
  const current = await d.getCurrentRevision(ctx, a.machineId, a.workingDir);
  if (a.baseRevision !== current)
    return { status: 'resync-required' as const, expectedRevision: current };
  const revision = current + 1;
  await d.insertDeltaBatch(ctx, { ...a, revision });
  await d.insertOperationReceipt(ctx, {
    machineId: a.machineId,
    workingDir: a.workingDir,
    operationId: a.operationId,
    revision,
    createdAt: Date.now(),
  });
  return { status: 'applied' as const, revision };
}
