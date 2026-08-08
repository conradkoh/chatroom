import { createStartBackgroundCapabilitiesDiscoveryDeps } from './bridge/capabilities-bridge.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { createDaemonRuntime } from './daemon-runtime.js';
import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { initDaemon } from './init-daemon.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { resolveLocalWebPort } from './resolve-local-web-port.js';
import { setRestartOrchestratorDb } from './restart-orchestrator.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { setTaskMonitorReadModelDb } from './task-monitor-runtime.js';
import { getConvexWsClient } from '../../infrastructure/convex/client.js';
import { setAssignedTaskSnapshotProvider } from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import { startBackgroundMachineCapabilitiesDiscovery } from '../domain/usecase/refresh-machine-capabilities.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { hydrateReadModelsFromConvex } from '../infrastructure/persistence/read-models/hydrate-from-convex.js';
import { listSnapshotViewsFromReadModels } from '../infrastructure/persistence/read-models/task-snapshot-adapter.js';
import { createConvexProjectionAdapter } from '../infrastructure/projection/convex/convex-projection-adapter.js';
import {
  isDaemonOrchestrationP1CutoverEnabled,
  isDaemonOrchestrationP1Enabled,
  isDaemonOrchestrationP2CutoverEnabled,
  isDaemonOrchestrationP2Enabled,
} from '../infrastructure/projection/feature-flags.js';
import { startOutboxDrainWorker } from '../infrastructure/projection/outbox-drain-worker.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';

export async function startDaemon(): Promise<void> {
  const init = await initDaemon();
  const wsClient = await getConvexWsClient();

  const persistence = createPersistenceStore(resolvePersistenceDbPath(init.machineId));
  const daemonDeps = createDaemonDeps({
    persistence,
    backend: init.backend,
    sessionId: init.sessionId,
    machineId: init.machineId,
  });

  let drainWorker: ReturnType<typeof startOutboxDrainWorker> | undefined;
  if (isDaemonOrchestrationP1Enabled()) {
    const adapter = createConvexProjectionAdapter({
      backend: init.backend,
      sessionId: init.sessionId,
      machineId: init.machineId,
    });
    drainWorker = startOutboxDrainWorker({
      db: persistence.db,
      projectEvent: (event) => adapter.project(event),
      validateProjectable: (event) => adapter.validateProjectable(event),
      isCutoverEnabled: isDaemonOrchestrationP1CutoverEnabled,
    });
    console.log('[daemon] Outbox drain worker started (P1)');
  }

  if (isDaemonOrchestrationP2Enabled()) {
    const { taskCount } = await hydrateReadModelsFromConvex({
      db: persistence.db,
      machineId: init.machineId,
      sessionId: init.sessionId,
      query: (fn, args) => init.backend.query(fn, args),
    });
    setTaskMonitorReadModelDb(persistence.db);
    setRestartOrchestratorDb(persistence.db);
    if (isDaemonOrchestrationP2CutoverEnabled()) {
      setAssignedTaskSnapshotProvider(() =>
        listSnapshotViewsFromReadModels(persistence.db, init.machineId)
      );
      console.log('[daemon] P2 cutover — snapshot store sourced from read models');
    }
    console.log(`[daemon] P2 read models hydrated (${taskCount} tasks)`);
  }

  const localWebPort = resolveLocalWebPort();
  const localWeb = await startLocalWebServer(
    { host: '127.0.0.1', port: localWebPort },
    { persistence, streamHub: daemonDeps.streamHub }
  );

  const subscribers = startAllSubscribers({
    wsClient,
    sessionId: init.sessionId,
    machineId: init.machineId,
    router: createDefaultEventRouterDeps(),
  });

  console.log(`[daemon] Local web UI: http://127.0.0.1:${localWeb.port}/health`);

  const layers = daemonSessionToLayers(init);
  startBackgroundMachineCapabilitiesDiscovery(
    createStartBackgroundCapabilitiesDiscoveryDeps(layers)
  );

  const runtime = createDaemonRuntime({ wsClient, layers });

  try {
    await runtime.run();
  } finally {
    drainWorker?.stop();
    await runtime.shutdown();
    await subscribers.stopAll();
    await localWeb.stop();
    persistence.close();
  }
}
