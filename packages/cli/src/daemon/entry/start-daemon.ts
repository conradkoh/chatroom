import { createStartBackgroundCapabilitiesDiscoveryDeps } from './bridge/capabilities-bridge.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { createDaemonRuntime } from './daemon-runtime.js';
import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { initDaemon } from './init-daemon.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { getConvexWsClient } from '../../infrastructure/convex/client.js';
import { startBackgroundMachineCapabilitiesDiscovery } from '../domain/usecase/refresh-machine-capabilities.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';

const DEFAULT_LOCAL_WEB_PORT = 18765;

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

  const localWebPort = Number(
    process.env.CHATROOM_LOCAL_WEB_PORT ?? String(DEFAULT_LOCAL_WEB_PORT)
  );
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
    await runtime.shutdown();
    await subscribers.stopAll();
    await localWeb.stop();
    persistence.close();
  }
}
