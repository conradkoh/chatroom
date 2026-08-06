import { Effect } from 'effect';

import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { startCommandLoopEffect } from '../../commands/machine/daemon-start/command-loop.js';
import { daemonSessionToLayers } from '../../commands/machine/daemon-start/daemon-layers.js';
import { initDaemon } from '../../commands/machine/daemon-start/init.js';
import { startBackgroundModelDiscoveryEffect } from '../../commands/machine/daemon-start/models-refresh.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';

const DEFAULT_LOCAL_WEB_PORT = 18765;

export async function startDaemonV2(): Promise<void> {
  const init = await initDaemon();

  const persistence = createPersistenceStore(resolvePersistenceDbPath(init.machineId));
  const daemonDeps = createDaemonDeps({ persistence });

  const localWebPort = Number(
    process.env.CHATROOM_LOCAL_WEB_PORT ?? String(DEFAULT_LOCAL_WEB_PORT)
  );
  const localWeb = await startLocalWebServer(
    { host: '127.0.0.1', port: localWebPort },
    { persistence, streamHub: daemonDeps.streamHub }
  );

  const subscribers = startAllSubscribers({
    wsClient: init.client,
    sessionId: init.sessionId,
    machineId: init.machineId,
    router: createDefaultEventRouterDeps(),
  });

  console.log(`[v2] Local web UI: http://127.0.0.1:${localWeb.port}/health`);

  const layers = daemonSessionToLayers(init);
  Effect.runFork(startBackgroundModelDiscoveryEffect.pipe(Effect.provide(layers)));

  try {
    await Effect.runPromise(startCommandLoopEffect.pipe(Effect.provide(layers)));
  } finally {
    await subscribers.stopAll();
    await localWeb.stop();
    persistence.close();
  }
}
