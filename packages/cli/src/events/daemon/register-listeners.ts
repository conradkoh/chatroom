/**
 * register-listeners — thin orchestrator that wires DaemonEventBus events to handler functions.
 *
 * Called once at daemon startup after the event bus is created.
 * Returns an unsubscribe function that removes all listeners (for tests/shutdown).
 */

import { Effect } from 'effect';

import { onAgentExitedCore, type AgentExitedDeps } from './agent/on-agent-exited.js';
import { onAgentStartedCore } from './agent/on-agent-started.js';
import { onAgentStoppedCore } from './agent/on-agent-stopped.js';
import type { DaemonEventBus } from './event-bus.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../commands/machine/daemon-start/daemon-services.js';

/** Flat deps for core — no DaemonContext. */
export interface RegisterEventListenersDeps {
  events: DaemonEventBus;
  handleExit: AgentExitedDeps['handleExit'];
}

/**
 * Core — wires agent lifecycle events to handler cores.
 * Returns unsubscribe function.
 */
export function registerEventListenersCore(deps: RegisterEventListenersDeps): () => void {
  const unsubs: (() => void)[] = [];

  unsubs.push(
    deps.events.on('agent:exited', (payload) =>
      onAgentExitedCore({ handleExit: deps.handleExit }, payload)
    )
  );
  unsubs.push(deps.events.on('agent:started', (payload) => onAgentStartedCore(payload)));
  unsubs.push(deps.events.on('agent:stopped', (payload) => onAgentStoppedCore(payload)));

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

/** Effect twin — yields DaemonSessionService + DaemonAgentProcessManagerService. */
// fallow-ignore-next-line unused-export
export const registerEventListenersEffect = (): Effect.Effect<
  () => void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const apm = yield* DaemonAgentProcessManagerService;

    return registerEventListenersCore({
      events: session.events,
      handleExit: (opts) => Effect.runPromise(apm.handleExit(opts)),
    });
  });
