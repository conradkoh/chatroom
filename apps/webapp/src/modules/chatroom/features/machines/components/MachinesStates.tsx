'use client';

import { AlertTriangle, Server } from 'lucide-react';

import { CopyButton } from '../../../components/CopyButton';

import { Skeleton } from '@/components/ui/skeleton';
import { getDaemonStartCommand } from '@/lib/environment';

/** Page-level loading state: three card-shaped skeleton rows. */
export function MachinesLoadingState() {
  return (
    <ul data-testid="machines-loading" aria-label="Loading machines" className="space-y-3">
      {[0, 1, 2].map((index) => (
        <li key={index}>
          <Skeleton className="h-[88px] w-full rounded-none" />
        </li>
      ))}
    </ul>
  );
}

/** No machines registered yet — shows the command that registers one. */
export function MachinesEmptyState() {
  const daemonStartCommand = getDaemonStartCommand();

  return (
    <div
      data-testid="machines-empty"
      className="flex flex-col items-center gap-3 border-2 border-dashed border-chatroom-border p-8 text-center"
    >
      <Server size={40} className="text-chatroom-text-muted" />
      <p className="text-sm font-bold">No machines registered</p>
      <p className="text-xs text-chatroom-text-muted">
        Run this command on a computer to register it. It appears here once the daemon connects.
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="machines-empty-command"
          className="break-all border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1.5 font-mono text-xs text-chatroom-status-success"
        >
          {daemonStartCommand}
        </code>
        <CopyButton
          text={daemonStartCommand}
          label="Copy"
          copiedLabel="Copied!"
          variant="compact"
        />
      </div>
      <p
        data-testid="machines-empty-import-hint"
        className="max-w-md text-xs text-chatroom-text-muted"
      >
        Importing a chatroom export needs a registered machine. Once one appears, open its menu and
        choose Import chatrooms….
      </p>
    </div>
  );
}

/** ErrorBoundary fallback for a failed machine query. */
export function MachinesLoadError() {
  return (
    <div
      data-testid="machines-error"
      role="alert"
      className="border border-chatroom-status-error/40 bg-chatroom-status-error/10 p-6"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="shrink-0 text-chatroom-status-error" />
        <div className="space-y-3">
          <div>
            <p className="text-sm font-bold">Could not load machines</p>
            <p className="text-xs text-chatroom-text-muted">Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-chatroom-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-chatroom-bg-primary hover:bg-chatroom-text-secondary"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
