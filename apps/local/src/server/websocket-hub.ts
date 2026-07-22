import type { WebSocket, WebSocketServer } from 'ws';

import type { ProcessManager } from './process-manager.js';
import type { ClientMessage, RuntimeConfigDefaults, ServerMessage } from '../shared/protocol.js';

export function attachWebSocketHub(
  wss: WebSocketServer,
  manager: ProcessManager,
  defaults: RuntimeConfigDefaults
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

  wss.on('connection', (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: 'snapshot' as const,
        phase: manager.phase,
        processes: manager.getProcesses(),
        logs: manager.getLogSnapshot(),
        defaults,
        runtime: manager.runtimeConfig,
      })
    );

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        switch (msg.type) {
          case 'start':
            void manager.startStack(msg.config);
            break;
          case 'stop':
            void manager.stopStack();
            break;
          case 'restart':
            manager.restart(msg.processId);
            break;
        }
      } catch {
        // ignore malformed
      }
    });
  });
}
