import { Copy, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import { SetupPanel } from './components/SetupPanel';
import { useWebSocket } from './use-websocket';
import type { ConnectionState } from './use-websocket';
import type { LogLine, ManagedProcessId, ProcessInfo, SessionPhase } from '../shared/protocol';

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
            key={`${line.timestamp}-${i}`}
            className={cn(
              'animate-log-line-in px-4 py-[1px] leading-5',
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
  const label =
    health === 'healthy'
      ? healthDetail === 'Hosted \u2014 external'
        ? 'Hosted'
        : 'Healthy'
      : health === 'checking'
        ? 'Checking'
        : health === 'unhealthy'
          ? (healthDetail ?? 'Unhealthy').slice(0, 20)
          : '\u2014';

  const colorClass =
    health === 'healthy'
      ? 'border-chatroom-status-success text-chatroom-status-success'
      : health === 'checking'
        ? 'border-chatroom-status-warning text-chatroom-status-warning'
        : health === 'unhealthy'
          ? 'border-chatroom-status-error text-chatroom-status-error'
          : 'border-chatroom-border text-chatroom-text-muted';

  const opacityClass = health === 'unknown' ? 'opacity-40' : 'opacity-100';

  return (
    <span className="health-badge-slot" title={healthDetail ?? undefined}>
      <Badge
        variant="outline"
        className={cn(
          'rounded-none text-[10px] transition-status transition-fade',
          colorClass,
          opacityClass,
          health === 'checking' && 'animate-status-pulse'
        )}
      >
        {label}
      </Badge>
    </span>
  );
}

function DashboardView({
  processes,
  logsByProcess,
  connectionState,
  phase,
  selectedId,
  setSelectedId,
  copyLabel,
  handleCopyLogs,
  stopStack,
  restart,
}: {
  processes: ProcessInfo[];
  logsByProcess: Record<ManagedProcessId, LogLine[]>;
  connectionState: ConnectionState;
  phase: SessionPhase;
  selectedId: ManagedProcessId;
  setSelectedId: (id: ManagedProcessId) => void;
  copyLabel: string;
  handleCopyLogs: () => void;
  stopStack: () => void;
  restart: (id: ManagedProcessId) => void;
}) {
  const selectedProcess = processes.find((p) => p.id === selectedId);
  const logLines = logsByProcess[selectedId] ?? [];

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
          <span
            className={cn(
              'inline-block h-2 w-2 transition-status',
              statusColor,
              connectionState === 'connecting' && 'animate-status-pulse'
            )}
          />
          {connectionState === 'connected'
            ? 'Connected'
            : connectionState === 'connecting'
              ? 'Connecting...'
              : 'Disconnected'}
        </div>
        <div
          className={cn(
            'phase-indicator-slot transition-phase-text',
            phase === 'starting' && 'text-chatroom-status-warning',
            phase === 'stopping' && 'text-chatroom-status-error',
            phase !== 'starting' && phase !== 'stopping' && 'text-transparent'
          )}
        >
          {phase === 'starting' ? 'Starting...' : phase === 'stopping' ? 'Stopping...' : '\u00A0'}
        </div>
        <h2 className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Processes
        </h2>
        <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
          {processes.map((p) => (
            <div
              key={p.id}
              className={cn(
                'group flex cursor-pointer items-center gap-2 border-2 p-2 transition-colors duration-150',
                selectedId === p.id
                  ? 'border-chatroom-border-strong bg-chatroom-bg-tertiary'
                  : 'border-transparent hover:bg-chatroom-bg-hover'
              )}
              onClick={() => setSelectedId(p.id)}
            >
              <span
                className={cn(
                  'inline-block h-2 w-2 shrink-0 transition-status',
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
              <span className="restart-button-slot">
                {isRunning && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 rounded-none p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      restart(p.id);
                    }}
                  >
                    <RotateCcw size={12} />
                  </Button>
                )}
              </span>
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
            className="gap-2 rounded-none min-w-[7.5rem]"
            onClick={handleCopyLogs}
            disabled={logLines.length === 0}
            title="Copy all logs to clipboard"
          >
            <Copy size={14} />
            <span key={copyLabel} className="animate-log-line-in">
              {copyLabel}
            </span>
          </Button>
        </div>
        <div key={selectedId} className="min-h-0 flex-1 overflow-hidden">
          <LogViewer logLines={logLines} />
        </div>
      </main>
    </div>
  );
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

  const showSetup = phase === 'idle';

  return (
    <div className="relative h-dvh overflow-hidden">
      <div
        className={cn(
          'absolute inset-0 transition-fade duration-300',
          showSetup ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!showSetup}
      >
        <SetupPanel defaults={defaults} onStart={startStack} />
      </div>
      <div
        className={cn(
          'absolute inset-0 transition-fade duration-300',
          showSetup ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
        )}
        aria-hidden={showSetup}
      >
        <DashboardView
          processes={processes}
          logsByProcess={logsByProcess}
          connectionState={connectionState}
          phase={phase}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          copyLabel={copyLabel}
          handleCopyLogs={handleCopyLogs}
          stopStack={stopStack}
          restart={restart}
        />
      </div>
    </div>
  );
}
