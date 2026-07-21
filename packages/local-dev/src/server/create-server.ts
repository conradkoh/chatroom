import { createServer } from 'node:http';

import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

import type { ProcessManager } from './process-manager.js';
import { attachWebSocketHub } from './websocket-hub.js';

const PORT = 3847;

export async function createAppServer(manager: ProcessManager) {
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
  attachWebSocketHub(wss, manager);

  return {
    port: PORT,
    async listen() {
      await new Promise<void>((resolve) => server.listen(PORT, resolve));
      process.stderr.write(`Local dev manager UI: http://localhost:${PORT}\n`);
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
