import { createStartBackgroundCapabilitiesDiscoveryDeps } from './bridge/capabilities-bridge.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { createDaemonRuntime } from './daemon-runtime.js';
import { asConvexSessionId } from './daemon-types.js';
import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { initDaemon } from './init-daemon.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { resolveLocalWebPort } from './resolve-local-web-port.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { getConvexWsClient } from '../../infrastructure/convex/client.js';
import { createLogServer, resolveLogsDbPath } from '../../infrastructure/log-server/index.js';
import { startBackgroundMachineCapabilitiesDiscovery } from '../domain/usecase/refresh-machine-capabilities.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { createLogRepository } from '../infrastructure/repository/log-repository.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';
import { createLogStreamHub } from '../local-web/server/log-stream-hub.js';
import { ingestChatroomEvent } from '../local-web/client/lib/socket.js';

export async function startDaemon(): Promise<void> {
  let resolveBoundPort!: (port: number) => void;
  const localWebPortReady = new Promise<number>((resolve) => {
    resolveBoundPort = resolve;
  });
  const logStreamHub = createLogStreamHub();
  const logServer = createLogServer(resolveLogsDbPath(), {
    onWrite: (entry) => logStreamHub.publish(entry),
  });
  let init: Awaited<ReturnType<typeof initDaemon>>;
  try {
    init = await initDaemon({
      logSink: logServer,
      logEvent: async (event) => {
        const port = await localWebPortReady;
        return ingestChatroomEvent(event, port);
      },
    });
  } catch (error) {
    logServer.close();
    throw error;
  }
  const wsClient = await getConvexWsClient();

  const persistence = createPersistenceStore(resolvePersistenceDbPath(init.machineId));
  const daemonDeps = createDaemonDeps({
    persistence,
    backend: init.backend,
    sessionId: init.sessionId,
    machineId: init.machineId,
  });

  const localWebPort = resolveLocalWebPort();
  const localWeb = await startLocalWebServer(
    { host: '127.0.0.1', port: localWebPort },
    {
      persistence,
      streamHub: daemonDeps.streamHub,
      logRepo: createLogRepository(logServer.db),
      logStreamHub,
      backend: init.backend,
      sessionId: init.sessionId,
    }
  );
  resolveBoundPort(localWeb.port);

  const subscribers = startAllSubscribers({
    wsClient,
    sessionId: asConvexSessionId(init.sessionId),
    machineId: init.machineId,
    router: createDefaultEventRouterDeps(),
  });

  console.log(`[daemon] Local web UI: http://127.0.0.1:${localWeb.port}/`);

  const layers = daemonSessionToLayers(init);
  startBackgroundMachineCapabilitiesDiscovery(
    createStartBackgroundCapabilitiesDiscoveryDeps(layers)
  );

  const runtime = createDaemonRuntime({ wsClient, layers });

  try {
    await runtime.run();
  } finally {
    await runtime.shutdown();
    await subscribers.stopAll();
    await localWeb.stop();
    persistence.close();
    logServer.flush();
    logServer.close();
  }
}
