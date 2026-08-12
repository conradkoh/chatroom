import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';

export function DaemonHeader({ status }: { status: ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-chatroom-border px-6 py-4">
      <div className="flex items-center gap-3">
        <Activity className="size-5 text-chatroom-text-muted" aria-hidden />
        <h1 className="text-sm font-semibold uppercase tracking-widest">Chatroom Daemon</h1>
      </div>
      {status}
    </header>
  );
}
