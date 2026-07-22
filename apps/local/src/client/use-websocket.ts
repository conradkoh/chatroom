import { useEffect, useRef, useState, useCallback } from 'react';

import type {
  LocalConfigSnapshot,
  LogLine,
  ManagedProcessId,
  ProcessInfo,
  ServerMessage,
} from '../shared/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [logsByProcess, setLogsByProcess] = useState<Record<ManagedProcessId, LogLine[]>>({
    convex: [],
    webapp: [],
    daemon: [],
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [config, setConfig] = useState<LocalConfigSnapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    setConnectionState('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => setConnectionState('connected');

    ws.onclose = () => {
      setConnectionState('disconnected');
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        switch (msg.type) {
          case 'snapshot':
            setProcesses(msg.processes);
            setLogsByProcess(msg.logs);
            setConfig(msg.config);
            break;
          case 'process-update':
            setProcesses((prev) => prev.map((p) => (p.id === msg.process.id ? msg.process : p)));
            break;
          case 'log':
            setLogsByProcess((prev) => ({
              ...prev,
              [msg.line.processId]: [...(prev[msg.line.processId] ?? []), msg.line],
            }));
            break;
          case 'config':
            setConfig(msg.config);
            break;
        }
      } catch {
        // ignore
      }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const restart = useCallback((processId: ManagedProcessId) => {
    wsRef.current?.send(JSON.stringify({ type: 'restart', processId }));
  }, []);

  return { processes, logsByProcess, connectionState, config, restart };
}
