import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  stopReason?: string;
  agentHarness?: string;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * Crash recovery is now fully owned by the daemon's `onAgentExited` handler:
 *   - On any unexpected exit, the daemon restarts the agent automatically.
 *   - Crash loop protection (max 3 restarts / 5 min) is enforced in the daemon.
 *   - Intentional stops (`user.stop`, `platform.team_switch`) skip restart.
 *
 * This backend function is a no-op kept as a hook for future observability needs.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function onAgentExited(_ctx: MutationCtx, _args: OnAgentExitedArgs): Promise<void> {
  // No-op: daemon owns restart logic.
}
