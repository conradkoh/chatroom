import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CliHttpServerConfig = {
  host: '127.0.0.1';
  port?: number;
};

export type CliHttpServerDeps = {
  dispatch: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
};

export type CliHttpServerHandle = {
  port: number;
  stop(): Promise<void>;
};

// fallow-ignore-next-line complexity
export async function startCliHttpServer(
  config: CliHttpServerConfig,
  deps: CliHttpServerDeps
): Promise<CliHttpServerHandle> {
  if (config.host !== '127.0.0.1') {
    throw new Error(`cli-http must bind to 127.0.0.1 only (got ${config.host})`);
  }

  const server = createServer((req, res) => {
    void deps.dispatch(req, res);
  });

  const port = config.port ?? 0;
  // fallow-ignore-next-line code-duplication
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve cli-http server address');
  }

  return {
    port: (address as AddressInfo).port,
    stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
