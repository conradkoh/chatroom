// fallow-ignore-file complexity

import type { QueryCtx } from '../../_generated/server';
import { expandFileTreeDeltaOperations } from '../../lib/fileTreeDeltaOps';
import * as c from '../repositories/checkpointRepository';
import * as d from '../repositories/deltaRepository';
import { MAX_FILE_TREE_DELTAS_PER_QUERY, validateFileTreeRevision } from '../validation';

export async function getFileTreeDeltasForApi(
  ctx: QueryCtx,
  machineId: string,
  workingDir: string,
  after: number
) {
  validateFileTreeRevision(after, 'afterRevision');
  const cp = await c.findCheckpoint(ctx, machineId, workingDir);
  const current = await d.getCurrentRevision(ctx, machineId, workingDir);
  if (after < (cp?.revision ?? 0))
    return {
      status: 'checkpoint-required' as const,
      checkpointRevision: cp?.revision ?? 0,
      currentRevision: current,
    };
  if (after > current) return { status: 'resync-required' as const, expectedRevision: current };
  const rows = await d.queryDeltasAfterRevision(
    ctx,
    machineId,
    workingDir,
    after,
    MAX_FILE_TREE_DELTAS_PER_QUERY
  );
  const out = rows.slice(0, MAX_FILE_TREE_DELTAS_PER_QUERY);
  if (!out.length) return null;
  return {
    status: 'ok' as const,
    deltas: out.map((r) => ({
      baseRevision: r.baseRevision,
      revision: r.revision,
      operations: expandFileTreeDeltaOperations(r.operations),
    })),
    ...(rows.length > MAX_FILE_TREE_DELTAS_PER_QUERY ? { hasMore: true as const } : {}),
  };
}
