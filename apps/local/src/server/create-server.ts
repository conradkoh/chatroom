import { createServer } from 'node:http';

import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

import type { LaunchConfig } from './parse-config.js';
import type { ProcessManager } from './process-manager.js';
import { attachWebSocketHub } from './websocket-hub.js';

export async function createAppServer(manager: ProcessManager, config: LaunchConfig) {
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
  attachWebSocketHub(wss, manager);

  return {
    port,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            process.stderr.write(
              `Port ${port} in use. Kill existing process or use: pnpm local -- --manager-port <port>\n`
            );
            reject(err);
          } else {
            reject(err);
          }
        });
        server.listen(port, () => resolve());
      });
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
