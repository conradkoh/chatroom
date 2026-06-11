/**
 * register-listeners — thin orchestrator that wires DaemonEventBus events to handler functions.
 *
 * Called once at daemon startup after the event bus is created.
 * Returns an unsubscribe function that removes all listeners (for tests/shutdown).
 */

import { onAgentExitedCore } from './agent/on-agent-exited.js';
import { onAgentStartedCore } from './agent/on-agent-started.js';
import { onAgentStoppedCore } from './agent/on-agent-stopped.js';
import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';

export function registerEventListeners(ctx: DaemonContext): () => void {
  const unsubs: (() => void)[] = [];

  unsubs.push(
    ctx.events.on('agent:exited', (payload) =>
      onAgentExitedCore(
        { handleExit: (opts) => ctx.deps.agentProcessManager.handleExit(opts) },
        payload
      )
    )
  );
  unsubs.push(ctx.events.on('agent:started', (payload) => onAgentStartedCore(payload)));
  unsubs.push(ctx.events.on('agent:stopped', (payload) => onAgentStoppedCore(payload)));

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
