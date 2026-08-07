import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

import type { ConvexBackupService } from './convex-backup-service.js';
import type { LaunchConfig } from './parse-config.js';
import type { ProcessManager } from './process-manager.js';
import type { RepoUpdateService } from './repo-update-service.js';
import { attachWebSocketHub } from './websocket-hub.js';
import type { RuntimeConfigDefaults } from '../shared/protocol.js';

export async function createAppServer(
  manager: ProcessManager,
  config: LaunchConfig,
  defaults: RuntimeConfigDefaults,
  repoUpdate: RepoUpdateService,
  backupService: ConvexBackupService
) {
  const port = config.managerPort;

  const vite = await createViteServer({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
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
  attachWebSocketHub(wss, manager, defaults, repoUpdate, backupService);

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
    },
    async close() {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve()))
      );
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      await vite.close();
    },
  };
}
