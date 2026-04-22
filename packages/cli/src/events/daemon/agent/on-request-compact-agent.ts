/**
 * Handles an agent.requestCompact event from chatroom_eventStream.
 * Calls driver.summarize(handle) to compact/summarize the session (if supported).
 */

import type { Id } from '../../../api.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { createDefaultDriverRegistry } from '../../../infrastructure/agent-drivers/registry.js';

export interface AgentRequestCompactEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  timestamp: number;
}

export async function onRequestCompactAgent(
  ctx: DaemonContext,
  event: AgentRequestCompactEventPayload
): Promise<void> {
  const { chatroomId, role } = event;

  console.log(`[${formatTimestamp()}] 📦 Compacting agent session for role=${role}`);

  try {
    // Get the running agent slot via agentProcessManager
    const slot = ctx.deps.agentProcessManager.getSlot(chatroomId, role);

    if (!slot || slot.state !== 'running') {
      console.log(`[${formatTimestamp()}] ℹ️  No running agent found for role=${role} to compact`);
      return;
    }

    // Get the agent handle (session-based or process-based)
    const handle = slot.agentHandle;
    if (!handle) {
      console.log(
        `[${formatTimestamp()}] ℹ️  Agent ${role} has no session handle (process-based harness?)`
      );
      return;
    }

    // Get the driver for this harness
    const registry = createDefaultDriverRegistry();
    const driver = registry.get(handle.harness);

    // If driver supports summarize, call it
    if (driver.summarize) {
      await driver.summarize(handle);
      console.log(`[${formatTimestamp()}] ✅ Agent session compacted (${role})`);
    } else {
      console.log(
        `[${formatTimestamp()}] ℹ️  Harness ${handle.harness} does not support compaction`
      );
    }
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️  Failed to compact agent session (${role}): ${getErrorMessage(err)}`
    );
  }
}
