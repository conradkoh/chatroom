import { useState, useRef, useEffect } from 'react';

import { useWebSocket } from './use-websocket';
import type { LogLine, ManagedProcessId } from '../shared/protocol';

const STATUS_LABELS: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  stopped: 'Stopped',
  crashed: 'Crashed',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function LogViewer({ logLines }: { logLines: LogLine[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines.length]);

  if (logLines.length === 0) {
    return <div className="empty-state">No logs yet — waiting for process output...</div>;
  }

  return (
    <div className="log-container">
      {logLines.map((line, i) => (
        <div key={i} className={`log-line ${line.stream}`}>
          <span className="timestamp">{formatTime(line.timestamp)}</span>
          <span className={`stream-badge ${line.stream}`}>
            {line.stream === 'stdout' ? 'OUT' : 'ERR'}
          </span>
          {line.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export function App() {
  const { processes, logsByProcess, connectionState, restart } = useWebSocket();
  const [selectedId, setSelectedId] = useState<ManagedProcessId>('convex');

  const selectedProcess = processes.find((p) => p.id === selectedId);
  const logLines = logsByProcess[selectedId] ?? [];

  return (
    <div className="layout">
      <div className="sidebar">
        <h1>Chatroom Local Dev</h1>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          {connectionState === 'connected'
            ? '● Connected'
            : connectionState === 'connecting'
              ? '◌ Connecting...'
              : '○ Disconnected'}
        </div>
        <h2>Processes</h2>
        {processes.map((p) => (
          <div
            key={p.id}
            className={`process-item ${selectedId === p.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(p.id)}
          >
            <div className={`status-dot ${p.status}`} title={STATUS_LABELS[p.status]} />
            <span className="process-name">{p.name}</span>
            <button
              className="restart-btn"
              onClick={(e) => {
                e.stopPropagation();
                restart(p.id);
              }}
            >
              Restart
            </button>
          </div>
        ))}
      </div>
      <div className="main-panel">
        <div className="log-header">
          {selectedProcess ? selectedProcess.name : 'Select a process'}
          {selectedProcess && (
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              ({STATUS_LABELS[selectedProcess.status]})
            </span>
          )}
        </div>
        <LogViewer logLines={logLines} />
      </div>
    </div>
  );
}
