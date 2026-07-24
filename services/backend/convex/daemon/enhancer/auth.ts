import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { getMachineOwner } from '../../auth/cli/machineAccess';

/** Daemon enhancer auth helpers — queries fail-open, mutations fail-closed. */
export async function getDaemonMachineAuth(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
) {
  return getMachineOwner(ctx, sessionId, machineId);
}
