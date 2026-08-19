import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server as SocketIOServer } from 'socket.io';

import type { LogStreamHub } from './log-stream-hub.js';
import type { EventStreamHub } from './event-stream-hub.js';
import { routeRequest } from './routes.js';
import { resolveClientDistDir, tryServeStatic } from './serve-static.js';
import { createStreamHub, type StreamHub } from './stream-hub.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { PersistenceStore } from '../../infrastructure/persistence/index.js';
import {
  createHarnessStreamRepository,
  createEmptyHarnessStreamRepository,
} from '../../infrastructure/repository/index.js';
import type { LogRepository } from '../../infrastructure/repository/log-repository.js';
import { registerSocketHandlers } from '../../infrastructure/socket/register-handlers.js';

export type LocalWebServerConfig = {
  host: '127.0.0.1';
  port?: number;
};

export type LocalWebServerDeps = {
  persistence?: PersistenceStore;
  streamHub?: StreamHub;
  logRepo?: LogRepository;
  logStreamHub?: LogStreamHub;
  eventStreamHub?: EventStreamHub;
  backend?: BackendOps;
  sessionId?: string;
  clientDistDir?: string;
};

export type LocalWebServerHandle = {
  port: number;
  streamHub: StreamHub;
  stop(): Promise<void>;
};

// fallow-ignore-next-line complexity
export async function startLocalWebServer(
  config: LocalWebServerConfig,
  deps: LocalWebServerDeps = {}
): Promise<LocalWebServerHandle> {
  if (config.host !== '127.0.0.1') {
    throw new Error(`local-web must bind to 127.0.0.1 only (got ${config.host})`);
  }

  const streamHub = deps.streamHub ?? createStreamHub();
  const clientDistDir = deps.clientDistDir ?? resolveClientDistDir();

  const server = createServer((req, res) => {
    if (tryServeStatic(req, res, clientDistDir)) return;
    routeRequest(req, res, { persistence: deps.persistence, streamHub });
  });

  const port = config.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve local-web server address');
  }

  const boundPort = (address as AddressInfo).port;

  const io = new SocketIOServer(server, {
    cors: { origin: false },
    serveClient: false,
  });

  const harnessStreamRepo = deps.persistence
    ? createHarnessStreamRepository(deps.persistence)
    : createEmptyHarnessStreamRepository();

  registerSocketHandlers(io, {
    port: boundPort,
    harnessStreamRepo,
    streamHub,
    logRepo: deps.logRepo,
    logStreamHub: deps.logStreamHub,
    eventStreamHub: deps.eventStreamHub,
    backend: deps.backend,
    sessionId: deps.sessionId,
  });

  return {
    port: boundPort,
    streamHub,
    stop() {
      return new Promise<void>((resolve, reject) => {
        void io.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

export async function createLocalWebServer(
  config: LocalWebServerConfig & { port: number },
  deps?: LocalWebServerDeps
): Promise<LocalWebServerHandle> {
  return startLocalWebServer(config, deps);
}
