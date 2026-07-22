import { createServer } from 'node:http';

import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

import type { LocalConfig } from './parse-config.js';
import { toConfigSnapshot } from './parse-config.js';
import type { ProcessManager } from './process-manager.js';
import { attachWebSocketHub } from './websocket-hub.js';

export async function createAppServer(manager: ProcessManager, config: LocalConfig) {
  const port = config.managerPort;

  const vite = await createViteServer({
    configFile: new URL('../../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'spa',
  });

  const server = createServer((req, res) => {
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  attachWebSocketHub(wss, manager, toConfigSnapshot(config));

  return {
    port,
    async listen() {
      await new Promise<void>((resolve) => server.listen(port, resolve));
      process.stderr.write(`Local dev manager UI: http://localhost:${port}\n`);
    },
    async close() {
      wss.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      await vite.close();
    },
  };
}
