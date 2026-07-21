import type { WebSocket, WebSocketServer } from 'ws';

import type { ProcessManager } from './process-manager.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

export function attachWebSocketHub(wss: WebSocketServer, manager: ProcessManager): void {
  const broadcast = (message: ServerMessage) => {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };

  manager.on('process', (process) => broadcast({ type: 'process-update', process }));
  manager.on('log', (line) => broadcast({ type: 'log', line }));

  wss.on('connection', (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        processes: manager.getProcesses(),
        logs: manager.getLogSnapshot(),
      } satisfies ServerMessage)
    );

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        if (msg.type === 'restart') manager.restart(msg.processId);
      } catch {
        // ignore malformed
      }
    });
  });
}
