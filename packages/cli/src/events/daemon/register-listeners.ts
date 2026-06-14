/**
 * register-listeners — thin orchestrator that wires DaemonEventBus events to handler functions.
 *
 * Called once at daemon startup after the event bus is created.
 * Returns an unsubscribe function that removes all listeners (for tests/shutdown).
 */

import { Effect, Runtime } from 'effect';

import { onAgentExitedEffect } from './agent/on-agent-exited.js';
import { logAgentStarted } from './agent/on-agent-started.js';
import { logAgentStopped } from './agent/on-agent-stopped.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../commands/machine/daemon-start/daemon-services.js';

export const registerEventListenersEffect = (): Effect.Effect<
  () => void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const runtime = yield* Effect.runtime<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();

    const unsubs: (() => void)[] = [];

    unsubs.push(
      session.events.on('agent:exited', (payload) => {
        Runtime.runFork(runtime)(onAgentExitedEffect(payload));
      })
    );
    unsubs.push(session.events.on('agent:started', (payload) => logAgentStarted(payload)));
    unsubs.push(session.events.on('agent:stopped', (payload) => logAgentStopped(payload)));

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  });
