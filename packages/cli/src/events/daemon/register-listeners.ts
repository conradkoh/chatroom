/**
 * register-listeners — thin orchestrator that wires DaemonEventBus events to handler functions.
 *
 * Called once at daemon startup after the event bus is created.
 * Returns an unsubscribe function that removes all listeners (for tests/shutdown).
 */

import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';
import { onAgentExited } from './agent/on-agent-exited.js';
import { onAgentStarted } from './agent/on-agent-started.js';
import { onAgentStopped } from './agent/on-agent-stopped.js';

export function registerEventListeners(ctx: DaemonContext): () => void {
  const unsubs: (() => void)[] = [];

  unsubs.push(ctx.events.on('agent:exited', (payload) => onAgentExited(ctx, payload)));
  unsubs.push(ctx.events.on('agent:started', (payload) => onAgentStarted(ctx, payload)));
  unsubs.push(ctx.events.on('agent:stopped', (payload) => onAgentStopped(ctx, payload)));

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
