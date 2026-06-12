/**
 * daemon-layers — builds granular Effect service layers from daemon bootstrap data.
 *
 * Provides daemonSessionToLayers(init) — flat-deps layer builder.
 */

import { Layer } from 'effect';

import {
  DaemonAgentProcessManagerServiceLive,
  DaemonMachineServiceLive,
  DaemonMutableStateServiceLive,
  DaemonSessionService,
  DaemonSpawningServiceLive,
} from './daemon-services.js';
import type { DaemonSessionInit } from './types.js';
import { BackendServiceLive } from '../../../infrastructure/services/backend.js';
import { ClockServiceLive } from '../../../infrastructure/services/clock.js';
import { FsServiceLive } from '../../../infrastructure/services/fs.js';
import { ProcessServiceLive } from '../../../infrastructure/services/process.js';

/**
 * Build all daemon Effect service layers from flat bootstrap data.
 *
 * Provides:
 *   - BackendService       wrapping init.backend
 *   - ProcessService       using real process.kill
 *   - ClockService         using real Date.now / setTimeout
 *   - FsService            using real node:fs/promises.stat
 *   - DaemonMachineService wrapping init.machine
 *   - DaemonSpawningService wrapping init.spawning
 *   - DaemonAgentProcessManagerService wrapping init.agentProcessManager
 *   - DaemonMutableStateService  wrapping mutable state in Effect.Ref
 *   - DaemonSessionService  carrying sessionId, machineId, config, agentServices, events
 */
export function daemonSessionToLayers(init: DaemonSessionInit) {
  return Layer.mergeAll(
    BackendServiceLive({
      mutation: (e, a) => init.backend.mutation(e, a),
      query: (e, a) => init.backend.query(e, a),
    }),
    ProcessServiceLive,
    ClockServiceLive,
    FsServiceLive,
    DaemonMachineServiceLive(init.machine),
    DaemonSpawningServiceLive(init.spawning),
    DaemonAgentProcessManagerServiceLive(init.agentProcessManager),
    DaemonMutableStateServiceLive({
      lastPushedGitState: init.lastPushedGitState,
      lastPushedModels: init.lastPushedModels,
      lastPushedHarnessFingerprint: init.lastPushedHarnessFingerprint,
      workspaceListStore: init.workspaceListStore,
    }),
    Layer.succeed(DaemonSessionService, {
      sessionId: init.sessionId,
      machineId: init.machineId,
      client: init.client,
      config: init.config,
      backend: init.backend,
      fs: init.fs,
      agentServices: init.agentServices,
      events: init.events,
      workspaceListStore: init.workspaceListStore,
      logger: init.logger,
      lastPushedGitState: init.lastPushedGitState,
      lastPushedModels: init.lastPushedModels,
      lastPushedHarnessFingerprint: init.lastPushedHarnessFingerprint,
    })
  );
}
