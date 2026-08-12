import { Activity } from 'lucide-react';

import { useDaemonHealth } from '@/hooks/use-daemon-health';
import { LogsPage } from '@/modules/logs/LogsPage';

export function App() {
  const health = useDaemonHealth();

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-chatroom-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Activity className="size-5 text-chatroom-text-muted" aria-hidden />
          <h1 className="text-sm font-semibold uppercase tracking-widest">Chatroom Daemon</h1>
        </div>
        <div className="text-xs text-chatroom-text-muted">
          {health.isLoading && 'Connecting…'}
          {health.isError && 'Disconnected'}
          {health.data && (
            <span>
              Port {health.data.port} · {health.data.service}
            </span>
          )}
        </div>
      </header>
      <nav className="flex gap-1 border-b border-chatroom-border px-6 py-2">
        <span className="bg-chatroom-bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-wide">
          Logs
        </span>
      </nav>
      <main className="flex flex-1 flex-col">
        <LogsPage />
      </main>
    </div>
  );
}
