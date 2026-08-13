/**
 * register-listeners — thin orchestrator that wires DaemonEventBus events to handler functions.
 *
 * Called once at daemon startup after the event bus is created.
 * Returns an unsubscribe function that removes all listeners (for tests/shutdown).
 */

import { Effect, Runtime } from 'effect';

import type { DaemonAgentProcessManagerService } from '../daemon-services.js';
import { DaemonSessionService } from '../daemon-services.js';
import { onAgentExitedEffect } from './agent/on-agent-exited.js';
import { logAgentStarted } from './agent/on-agent-started.js';
import { logAgentStopped } from './agent/on-agent-stopped.js';
import { isDaemonOrchestrationP3LocalDeliveryEnabled } from '../../infrastructure/projection/feature-flags.js';
import { getNativeTaskDeliveryCoordinator } from '../native-delivery/native-task-delivery-coordinator.js';

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
    if (isDaemonOrchestrationP3LocalDeliveryEnabled()) {
      unsubs.push(session.events.on('orchestration:task-ready', (payload) => {
        getNativeTaskDeliveryCoordinator().tryInjectNextForRole(payload.chatroomId, payload.role);
      }));
    }

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  });
