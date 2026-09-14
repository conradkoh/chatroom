import { createStartBackgroundCapabilitiesDiscoveryDeps } from './bridge/capabilities-bridge.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import { createDaemonRuntime } from './daemon-runtime.js';
import { asConvexSessionId } from './daemon-types.js';
import { createDefaultEventRouterDeps } from './default-router-deps.js';
import { createDaemonDeps } from './deps.js';
import { executeChatroomStopCommand } from './execute-chatroom-stop-command.js';
import { initDaemon } from './init-daemon.js';
import { resolvePersistenceDbPath } from './persistence-path.js';
import { resolveLocalWebPort } from './resolve-local-web-port.js';
import { startAllSubscribers } from './subscriber-registry.js';
import { api } from '../../api.js';
import { getConvexWsClient } from '../../infrastructure/convex/client.js';
import { createLogServer, resolveLogsDbPath } from '../../infrastructure/log-server/index.js';
import { loadDaemonState } from '../../infrastructure/machine/daemon-state.js';
import { startBackgroundMachineCapabilitiesDiscovery } from '../domain/usecase/refresh-machine-capabilities.js';
import type { ClaimedMachineCommand } from '../infrastructure/convex/subscribers/machine-command-inbox.js';
import { createPersistenceStore } from '../infrastructure/persistence/index.js';
import { createLogRepository } from '../infrastructure/repository/log-repository.js';
import { ingestChatroomEvent } from '../local-web/client/lib/socket.js';
import { startLocalWebServer } from '../local-web/server/create-local-web-server.js';
import { createEventStreamHub } from '../local-web/server/event-stream-hub.js';
import { createLogStreamHub } from '../local-web/server/log-stream-hub.js';

export async function startDaemon(): Promise<void> {
  let resolveBoundPort!: (port: number) => void;
  const localWebPortReady = new Promise<number>((resolve) => {
    resolveBoundPort = resolve;
  });
  const logStreamHub = createLogStreamHub();
  const eventStreamHub = createEventStreamHub();
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
    logEvent: init.logEvent,
  });

  const localWebPort = resolveLocalWebPort();
  // fallow-ignore-next-line complexity
  const debugState = async (chatroomId: string) => {
    const persisted = await loadDaemonState(init.machineId);
    const persistedAgents = Object.fromEntries(
      Object.entries(persisted?.agents ?? {}).filter(([key]) => key.startsWith(`${chatroomId}/`))
    );
    let inbox: unknown[] = [];
    let inboxError: string | undefined;
    try {
      const rows = (await init.backend.query(api.daemon.machineCommandInbox.list, {
        sessionId: asConvexSessionId(init.sessionId),
        machineId: init.machineId,
      })) as { command?: { chatroomId?: string }; [key: string]: unknown }[];
      inbox = rows.filter((row) => row.command?.chatroomId === chatroomId);
    } catch (error) {
      inboxError = error instanceof Error ? error.message : String(error);
    }
    return {
      capturedAt: new Date().toISOString(),
      process: {
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
      },
      daemon: {
        machineId: init.machineId,
        convexUrl: init.convexUrl,
        localWebPort,
        config: init.config
          ? {
              hostname: init.config.hostname,
              os: init.config.os,
              registeredAt: init.config.registeredAt,
              lastSyncedAt: init.config.lastSyncedAt,
              availableHarnesses: init.config.availableHarnesses,
              harnessVersions: init.config.harnessVersions,
            }
          : null,
      },
      chatroomId,
      manager: init.agentProcessManager.getDebugState(chatroomId),
      service: init.agentProcessManagerService.debugState?.() ?? null,
      persistedState: {
        version: persisted?.version ?? null,
        updatedAt: persisted?.updatedAt ?? null,
        lastSeenEventId: persisted?.lastSeenEventId ?? null,
        agents: persistedAgents,
      },
      convex: {
        machineCommandInbox: inbox,
        ...(inboxError ? { machineCommandInboxError: inboxError } : {}),
      },
    };
  };
  const localWeb = await startLocalWebServer(
    { host: '127.0.0.1', port: localWebPort },
    {
      persistence,
      streamHub: daemonDeps.streamHub,
      logRepo: createLogRepository(logServer.db),
      logStreamHub,
      eventStreamHub,
      backend: init.backend,
      sessionId: init.sessionId,
      debugState,
    }
  );
  resolveBoundPort(localWeb.port);

  const subscribers = startAllSubscribers({
    wsClient,
    sessionId: asConvexSessionId(init.sessionId),
    machineId: init.machineId,
    router: createDefaultEventRouterDeps(),
    onAgentStopCommand: (command) => {
      const stopCommand = command as ClaimedMachineCommand & {
        type: 'agent.stop';
        chatroomId: string;
        role?: string;
        workingDir?: string;
        finalizeChatroom?: boolean;
      };
      return executeChatroomStopCommand({
        apm: init.agentProcessManager,
        chatroomId: stopCommand.chatroomId,
        commandId: stopCommand.commandId,
        role: stopCommand.role,
        workingDir: stopCommand.workingDir,
        finalizeChatroom: stopCommand.finalizeChatroom,
        runSerializedForAgent: init.agentProcessManagerService.runSerializedForAgent,
      });
    },
  });

  console.log(`[daemon] Local web UI: http://127.0.0.1:${localWeb.port}/`);

  const layers = daemonSessionToLayers(init);
  init.agentProcessManagerService.startProcessing();
  startBackgroundMachineCapabilitiesDiscovery(
    createStartBackgroundCapabilitiesDiscoveryDeps(layers)
  );

  const runtime = createDaemonRuntime({
    wsClient,
    layers,
    agentLifecycleOutbox: init.agentLifecycleOutbox,
    agentProcessManagerService: init.agentProcessManagerService,
  });

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
