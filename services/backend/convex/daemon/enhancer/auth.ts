import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { getMachineOwner } from '../../auth/cli/machineAccess';

/** Match remote-agent daemon auth: session + machine owner, fail-open for queries. */
export async function getDaemonMachineAuth(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
) {
  return getMachineOwner(ctx, sessionId, machineId);
}
