import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { routeRequest } from './routes.js';
import { createStreamHub, type StreamHub } from './stream-hub.js';
import type { PersistenceStore } from '../../infrastructure/persistence/index.js';

export type LocalWebServerConfig = {
  host: '127.0.0.1';
  port?: number;
};

export type LocalWebServerDeps = {
  persistence?: PersistenceStore;
  streamHub?: StreamHub;
};

export type LocalWebServerHandle = {
  port: number;
  streamHub: StreamHub;
  stop(): Promise<void>;
};

export async function startLocalWebServer(
  config: LocalWebServerConfig,
  deps: LocalWebServerDeps = {}
): Promise<LocalWebServerHandle> {
  if (config.host !== '127.0.0.1') {
    throw new Error(`local-web must bind to 127.0.0.1 only (got ${config.host})`);
  }

  const streamHub = deps.streamHub ?? createStreamHub();
  const server = createServer((req, res) => {
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

  return {
    port: (address as AddressInfo).port,
    streamHub,
    stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
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
