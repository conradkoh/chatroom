/**
 * DaemonContextService — Effect Context.Tag wrapping the existing DaemonContext.
 *
 * This is the adapter that lets Effect programs access daemon state without
 * changing the existing DaemonContext or DaemonDeps structure.
 *
 * Also provides `daemonContextToLayers()` — a convenience builder that creates
 * all granular Effect service layers from a DaemonContext for use in production.
 */

import { Context, Layer } from 'effect';

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

export class DaemonContextService extends Context.Tag('DaemonContextService')<
  DaemonContextService,
  DaemonContext
>() {}

/**
 * Build all daemon Effect service layers from a DaemonContext.
 *
 * Provides:
 *   - BackendService       wrapping ctx.deps.backend
 *   - ProcessService       using real process.kill (matches production deps)
 *   - ClockService         using real Date.now / setTimeout
 *   - FsService            using real node:fs/promises.stat
 *   - DaemonMachineService wrapping ctx.deps.machine (MachineStateOps)
 *   - DaemonSpawningService wrapping ctx.deps.spawning (SpawningOps)
 *   - DaemonAgentProcessManagerService wrapping ctx.deps.agentProcessManager
 *   - DaemonSessionService  carrying sessionId, machineId, config, agentServices, events
 *   - DaemonContextService  carrying the full DaemonContext (backward-compat)
 *
 * Used to wire the Effect pipeline in production and in tests via Layer.provide.
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
      // Identity
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      client: ctx.client,
      config: ctx.config,
      // Flat deps (remove ctx.deps.xxx indirection)
      backend: ctx.deps.backend,
      fs: ctx.deps.fs,
      // Shared data
      agentServices: ctx.agentServices,
      events: ctx.events,
      workspaceListStore: ctx.workspaceListStore,
      logger: ctx.logger,
      // Mutable state (same references as ctx — intentional shared mutation)
      lastPushedGitState: ctx.lastPushedGitState,
      lastPushedModels: ctx.lastPushedModels,
      lastPushedHarnessFingerprint: ctx.lastPushedHarnessFingerprint,
    }),
    Layer.succeed(DaemonContextService, ctx)
  );
}
