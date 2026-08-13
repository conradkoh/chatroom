import { createStartBackgroundCapabilitiesDiscoveryDeps } from './bridge/capabilities-bridge.js';
import { dispatchCliHttpRequest } from './command-router.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { createDaemonRuntime } from './daemon-runtime.js';
import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { initDaemon } from './init-daemon.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { resolveCliHttpPort } from './resolve-cli-http-port.js';
import { resolveLocalWebPort } from './resolve-local-web-port.js';
import { setRestartOrchestratorDb } from './restart-orchestrator.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { setTaskMonitorReadModelDb } from './task-monitor-runtime.js';
import { setNativeDeliveryReadModelDb } from './native-delivery/native-task-delivery-coordinator.js';
import { getConvexWsClient } from '../../infrastructure/convex/client.js';
import { setAssignedTaskSnapshotProvider } from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import { startBackgroundMachineCapabilitiesDiscovery } from '../domain/usecase/refresh-machine-capabilities.js';
import { setAgentLifecyclePersistence } from '../infrastructure/agent-process-manager/agent-lifecycle-port.js';
import { startCliHttpServer } from '../infrastructure/inbound/local/cli-http-server.js';
import { setEnhancerQueueDb } from '../infrastructure/persistence/enhancer-queue.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { hydrateReadModelsFromConvex } from '../infrastructure/persistence/read-models/hydrate-from-convex.js';
import { listSnapshotViewsFromReadModels } from '../infrastructure/persistence/read-models/task-snapshot-adapter.js';
import { createConvexProjectionAdapter } from '../infrastructure/projection/convex/convex-projection-adapter.js';
import {
  assertOrchestrationFlagCompatibility,
  isDaemonOrchestrationP1CutoverEnabled,
  isDaemonOrchestrationP1Enabled,
  isDaemonOrchestrationP2CutoverEnabled,
  isDaemonOrchestrationP2Enabled,
} from '../infrastructure/projection/feature-flags.js';
import { startOutboxDrainWorker } from '../infrastructure/projection/outbox-drain-worker.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';

export async function startDaemon(): Promise<void> {
  assertOrchestrationFlagCompatibility();
  const init = await initDaemon();
  const wsClient = await getConvexWsClient();

  const persistence = createPersistenceStore(resolvePersistenceDbPath(init.machineId));
  setAgentLifecyclePersistence(persistence);
  setEnhancerQueueDb(persistence.db);
  setNativeDeliveryReadModelDb(persistence.db);
  const daemonDeps = createDaemonDeps({
    persistence,
    backend: init.backend,
    sessionId: init.sessionId as never,
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

  const cliHttp = await startCliHttpServer(
    { host: '127.0.0.1', port: resolveCliHttpPort() },
    {
      dispatch: (req, res) =>
        dispatchCliHttpRequest(req, res, {
          machineId: init.machineId,
          sessionId: init.sessionId,
          db: persistence.db,
          appendEvent: (event) => persistence.append(event),
          query: (fn, args) => init.backend.query(fn, args),
          emitOrchestrationEvent: (event) => init.events.emit('orchestration:task-ready', { ...event, chatroomId: event.chatroomId as never }),
        }),
    }
  );

  // P5: when DAEMON_ORCHESTRATION_P5 is on, startAllSubscribers registers only
  // user-intent inbound subscribers (no assigned-task/enhancer orchestration subs).
  const subscribers = startAllSubscribers({
    wsClient,
    sessionId: init.sessionId as never,
    machineId: init.machineId,
    router: createDefaultEventRouterDeps(),
  });

  console.log(`[daemon] Local web UI: http://127.0.0.1:${localWeb.port}/health`);
  console.log(`[daemon] CLI HTTP: http://127.0.0.1:${cliHttp.port}/handoff`);

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
    await cliHttp.stop();
    persistence.close();
  }
}
