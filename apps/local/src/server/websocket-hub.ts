import type { WebSocket, WebSocketServer } from 'ws';

import type { ProcessManager } from './process-manager.js';
import type { RepoUpdateService } from './repo-update-service.js';
import { parseRuntimeConfig } from '../shared/parse-runtime-config.js';
import type { ClientMessage, RuntimeConfigDefaults, ServerMessage } from '../shared/protocol.js';

export function attachWebSocketHub(
  wss: WebSocketServer,
  manager: ProcessManager,
  defaults: RuntimeConfigDefaults,
  repoUpdate: RepoUpdateService
): void {
  const broadcast = (message: ServerMessage) => {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };

  manager.on('process', (process) => broadcast({ type: 'process-update', process }));
  manager.on('log', (line) => broadcast({ type: 'log', line }));
  manager.on('phase', (phase) => broadcast({ type: 'phase', phase }));
  manager.on('logs-clear', (processId) => broadcast({ type: 'logs-clear', processId }));
  repoUpdate.on('update', (update) => broadcast({ type: 'repo-update', update }));

  wss.on('connection', (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: 'snapshot' as const,
        phase: manager.phase,
        processes: manager.getProcesses(),
        logs: manager.getLogSnapshot(),
        defaults,
        runtime: manager.runtimeConfig,
        repoUpdate: repoUpdate.getStatus(),
      })
    );

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        switch (msg.type) {
          case 'start': {
            const config = parseRuntimeConfig(msg.config);
            if (!config) break;
            void manager.startStack(config);
            break;
          }
          case 'stop':
            void manager.stopStack();
            break;
          case 'restart':
            void manager.restart(msg.processId);
            break;
          case 'check-repo-update':
            void repoUpdate.check();
            break;
          case 'apply-repo-update':
            void repoUpdate.apply(manager).catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              process.stderr.write(`apply-repo-update failed: ${message}\n`);
            });
            break;
        }
      } catch {
        // ignore malformed
      }
    });
  });
}
