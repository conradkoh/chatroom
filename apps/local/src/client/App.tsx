import { Copy, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import { SetupPanel } from './components/SetupPanel';
import { useWebSocket } from './use-websocket';
import type { LogLine, ManagedProcessId } from '../shared/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting',
  starting: 'Starting',
  running: 'Running',
  stopped: 'Stopped',
  crashed: 'Crashed',
  skipped: 'Skipped',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatLogLine(line: LogLine): string {
  const badge = line.stream === 'stdout' ? 'OUT' : 'ERR';
  return `${formatTime(line.timestamp)} [${badge}] ${line.text}`;
}

function LogViewer({ logLines }: { logLines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logLines.length]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection || !logContainerRef.current) return;
        const range = document.createRange();
        range.selectNodeContents(logContainerRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (logLines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto text-sm text-chatroom-text-muted">
        No logs yet — waiting for process output...
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto font-mono text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-chatroom-status-info"
      tabIndex={0}
      role="log"
      aria-label="Process logs"
    >
      <div ref={logContainerRef}>
        {logLines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'px-4 py-[1px] leading-5',
              line.stream === 'stderr' ? 'text-chatroom-status-error' : 'text-chatroom-text-primary'
            )}
          >
            <span className="mr-2 select-none text-chatroom-text-muted">
              {formatTime(line.timestamp)}
            </span>
            <Badge
              variant="outline"
              className="mr-2 w-12 rounded-none px-0 text-center text-[10px] font-bold uppercase leading-none"
            >
              {line.stream === 'stdout' ? 'OUT' : 'ERR'}
            </Badge>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthBadge({ health, healthDetail }: { health: string; healthDetail: string | null }) {
  if (health === 'healthy') {
    return (
      <Badge
        variant="outline"
        className="rounded-none border-chatroom-status-success text-[10px] text-chatroom-status-success"
      >
        {healthDetail === 'Hosted — external' ? 'Hosted' : 'Healthy'}
      </Badge>
    );
  }
  if (health === 'checking') {
    return (
      <Badge
        variant="outline"
        className="rounded-none border-chatroom-status-warning text-[10px] text-chatroom-status-warning"
      >
        Checking...
      </Badge>
    );
  }
  if (health === 'unhealthy') {
    return (
      <Badge
        variant="outline"
        className="rounded-none border-chatroom-status-error text-[10px] text-chatroom-status-error"
      >
        {healthDetail ?? 'Unhealthy'}
      </Badge>
    );
  }
  return null;
}

export function App() {
  const {
    processes,
    logsByProcess,
    connectionState,
    phase,
    defaults,
    startStack,
    stopStack,
    restart,
  } = useWebSocket();
  const [selectedId, setSelectedId] = useState<ManagedProcessId>('convex');
  const [copyLabel, setCopyLabel] = useState('Copy logs');

  const selectedProcess = processes.find((p) => p.id === selectedId);
  const logLines = logsByProcess[selectedId] ?? [];

  const handleCopyLogs = async () => {
    if (logLines.length === 0) return;
    const text = logLines.map(formatLogLine).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel('Copied!');
    } catch {
      setCopyLabel('Copy failed');
    } finally {
      window.setTimeout(() => setCopyLabel('Copy logs'), 1500);
    }
  };

  if (phase === 'idle') {
    return <SetupPanel defaults={defaults} onStart={startStack} />;
  }

  const statusColor =
    connectionState === 'connected'
      ? 'bg-chatroom-status-success'
      : connectionState === 'connecting'
        ? 'bg-chatroom-status-warning'
        : 'bg-chatroom-text-muted';

  const isRunning = phase === 'running';

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col gap-2 overflow-hidden border-r-2 border-chatroom-border bg-chatroom-bg-secondary p-4">
        <h1 className="text-sm font-bold uppercase tracking-wider">Chatroom Local</h1>
        <div className="flex items-center gap-1.5 text-[11px] text-chatroom-text-muted">
          <span className={cn('inline-block h-2 w-2', statusColor)} />
          {connectionState === 'connected'
            ? 'Connected'
            : connectionState === 'connecting'
              ? 'Connecting...'
              : 'Disconnected'}
        </div>
        {phase === 'starting' && (
          <div className="text-[10px] text-chatroom-status-warning">Starting...</div>
        )}
        {phase === 'stopping' && (
          <div className="text-[10px] text-chatroom-status-error">Stopping...</div>
        )}
        <h2 className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Processes
        </h2>
        <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
          {processes.map((p) => (
            <div
              key={p.id}
              className={cn(
                'group flex cursor-pointer items-center gap-2 border-2 p-2 transition-colors',
                selectedId === p.id
                  ? 'border-chatroom-border-strong bg-chatroom-bg-tertiary'
                  : 'border-transparent hover:bg-chatroom-bg-hover'
              )}
              onClick={() => setSelectedId(p.id)}
            >
              <span
                className={cn(
                  'inline-block h-2 w-2 shrink-0',
                  (p.status === 'pending' || p.status === 'stopped') && 'bg-chatroom-text-muted',
                  p.status === 'starting' && 'bg-chatroom-status-warning animate-pulse',
                  p.status === 'running' && 'bg-chatroom-status-success',
                  p.status === 'crashed' && 'bg-chatroom-status-error',
                  p.status === 'skipped' && 'bg-chatroom-text-muted'
                )}
                title={STATUS_LABELS[p.status]}
              />
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm">
                {p.name}
              </span>
              <HealthBadge health={p.health} healthDetail={p.healthDetail} />
              {isRunning && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-none px-2 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    restart(p.id);
                  }}
                >
                  <RotateCcw size={12} />
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-auto shrink-0">
          <Button
            variant="destructive"
            size="sm"
            className="w-full rounded-none"
            onClick={stopStack}
            disabled={phase === 'stopping'}
          >
            Stop Stack
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b-2 border-chatroom-border px-4 py-3">
          <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold">
            {selectedProcess ? selectedProcess.name : 'Select a process'}
            {selectedProcess && (
              <span className="ml-3 text-xs font-normal text-chatroom-text-muted">
                ({STATUS_LABELS[selectedProcess.status]})
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-none"
            onClick={handleCopyLogs}
            disabled={logLines.length === 0}
            title="Copy all logs to clipboard"
          >
            <Copy size={14} />
            {copyLabel}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <LogViewer logLines={logLines} />
        </div>
      </main>
    </div>
  );
}
