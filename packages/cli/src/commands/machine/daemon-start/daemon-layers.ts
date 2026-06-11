/**
 * daemon-layers — builds granular Effect service layers from a DaemonContext.
 *
 * Provides daemonContextToLayers() for wiring Effect pipelines in production and tests.
 */

import { Layer } from 'effect';

import {
  DaemonAgentProcessManagerServiceLive,
  DaemonMachineServiceLive,
  DaemonSessionService,
  DaemonSpawningServiceLive,
} from './daemon-services.js';
import type { DaemonContext } from './types.js';
import { BackendServiceLive } from '../../../infrastructure/services/backend.js';
import { ClockServiceLive } from '../../../infrastructure/services/clock.js';
import { FsServiceLive } from '../../../infrastructure/services/fs.js';
import { ProcessServiceLive } from '../../../infrastructure/services/process.js';

/**
 * Build all daemon Effect service layers from a DaemonContext.
 *
 * Provides:
 *   - BackendService       wrapping ctx.deps.backend
 *   - ProcessService       using real process.kill
 *   - ClockService         using real Date.now / setTimeout
 *   - FsService            using real node:fs/promises.stat
 *   - DaemonMachineService wrapping ctx.deps.machine
 *   - DaemonSpawningService wrapping ctx.deps.spawning
 *   - DaemonAgentProcessManagerService wrapping ctx.deps.agentProcessManager
 *   - DaemonSessionService  carrying sessionId, machineId, config, agentServices, events
 */
export function daemonContextToLayers(ctx: DaemonContext) {
  return Layer.mergeAll(
    BackendServiceLive({
      mutation: (e, a) => ctx.deps.backend.mutation(e, a),
      query: (e, a) => ctx.deps.backend.query(e, a),
    }),
    ProcessServiceLive,
    ClockServiceLive,
    FsServiceLive,
    DaemonMachineServiceLive(ctx.deps.machine),
    DaemonSpawningServiceLive(ctx.deps.spawning),
    DaemonAgentProcessManagerServiceLive(ctx.deps.agentProcessManager),
    Layer.succeed(DaemonSessionService, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      client: ctx.client,
      config: ctx.config,
      backend: ctx.deps.backend,
      fs: ctx.deps.fs,
      agentServices: ctx.agentServices,
      events: ctx.events,
      workspaceListStore: ctx.workspaceListStore,
      logger: ctx.logger,
      lastPushedGitState: ctx.lastPushedGitState,
      lastPushedModels: ctx.lastPushedModels,
      lastPushedHarnessFingerprint: ctx.lastPushedHarnessFingerprint,
    })
  );
}
