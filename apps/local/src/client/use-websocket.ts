import { useEffect, useRef, useState, useCallback } from 'react';

import type {
  ClientMessage,
  ConvexBackupStatus,
  LogLine,
  ManagedProcessId,
  ProcessInfo,
  RuntimeConfig,
  RuntimeConfigDefaults,
  RepoUpdateStatus,
  ServerMessage,
  SessionPhase,
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
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [defaults, setDefaults] = useState<RuntimeConfigDefaults | null>(null);
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [repoUpdate, setRepoUpdate] = useState<RepoUpdateStatus>({
    status: 'idle',
    localVersion: null,
    remoteVersion: null,
    error: null,
  });
  const [convexBackup, setConvexBackup] = useState<ConvexBackupStatus>({
    status: 'idle',
    backups: [],
    error: null,
  });
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
            setPhase(msg.phase);
            setDefaults(msg.defaults);
            setRuntime(msg.runtime);
            setRepoUpdate(msg.repoUpdate);
            setConvexBackup(msg.backup);
            break;
          case 'phase':
            setPhase(msg.phase);
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
          case 'logs-clear':
            setLogsByProcess((prev) => ({
              ...prev,
              [msg.processId]: [],
            }));
            break;
          case 'runtime-config':
            setRuntime(msg.runtime);
            break;
          case 'repo-update':
            setRepoUpdate(msg.update);
            break;
          case 'convex-backup':
            setConvexBackup(msg.backup);
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

  const send = useCallback((msg: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  const startStack = useCallback(
    (config: RuntimeConfig) => send({ type: 'start', config }),
    [send]
  );

  const stopStack = useCallback(() => send({ type: 'stop' }), [send]);

  const restart = useCallback(
    (processId: ManagedProcessId) => send({ type: 'restart', processId }),
    [send]
  );

  const checkRepoUpdate = useCallback(() => send({ type: 'check-repo-update' }), [send]);

  const applyRepoUpdate = useCallback(() => send({ type: 'apply-repo-update' }), [send]);

  const listConvexBackups = useCallback(() => send({ type: 'list-convex-backups' }), [send]);

  const createConvexBackup = useCallback(() => send({ type: 'create-convex-backup' }), [send]);

  const restoreConvexBackup = useCallback(
    (backupId: string) => send({ type: 'restore-convex-backup', backupId }),
    [send]
  );

  const deleteConvexBackup = useCallback(
    (backupId: string) => send({ type: 'delete-convex-backup', backupId }),
    [send]
  );

  return {
    processes,
    logsByProcess,
    connectionState,
    phase,
    defaults,
    runtime,
    repoUpdate,
    convexBackup,
    startStack,
    stopStack,
    restart,
    checkRepoUpdate,
    applyRepoUpdate,
    listConvexBackups,
    createConvexBackup,
    restoreConvexBackup,
    deleteConvexBackup,
  };
}
