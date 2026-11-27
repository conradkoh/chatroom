'use client';

import { IMPORT_MACHINE_HELP_COPY } from '../../lib/transferCopy';

import { InlineFeedback } from '@/components/inline-feedback';
import { cn } from '@/lib/utils';

/** The machine a dialog is locked to. `connected` is live: `undefined` while still checking. */
export interface ImportTarget {
  machineId: string;
  /** alias || hostname, from MachineRowModel.displayName. */
  displayName: string;
  hostname: string;
  connected: boolean | undefined;
}

interface ImportTargetMachineProps {
  target: ImportTarget;
  /** File and Select steps show the help copy and offline note. Progress and Results hide them. */
  showHelp: boolean;
}

/** Persistent target strip. It is read-only: the target is the card's machine. */
// fallow-ignore-next-line complexity
export function ImportTargetMachine({ target, showHelp }: ImportTargetMachineProps) {
  const { connected } = target;
  return (
    <section aria-label="Target machine" data-testid="import-target" className="shrink-0 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-chatroom-border bg-chatroom-bg-tertiary px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Import to
        </span>
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0',
            connected === true
              ? 'bg-chatroom-status-success'
              : connected === undefined
                ? 'animate-pulse bg-chatroom-border-strong'
                : 'bg-chatroom-text-muted'
          )}
        />
        <span
          data-testid="import-target-name"
          className="min-w-0 truncate text-xs font-bold uppercase tracking-wide"
        >
          {target.displayName}
        </span>
        <span className="min-w-0 truncate font-mono text-[10px] text-chatroom-text-muted">
          {target.hostname}
        </span>
        <span
          data-testid="import-target-status"
          className={cn(
            'ml-auto text-[10px] font-bold uppercase',
            connected === true ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'
          )}
        >
          {connected === undefined ? 'Checking…' : connected ? 'Online' : 'Offline'}
        </span>
      </div>
      {showHelp && <p className="text-xs text-chatroom-text-muted">{IMPORT_MACHINE_HELP_COPY}</p>}
      {showHelp && connected === false && (
        <InlineFeedback
          feedback={{
            id: 1,
            tone: 'info',
            message: `${target.displayName} is offline. The chatrooms are created now; agents cannot start until its daemon runs.`,
          }}
        />
      )}
    </section>
  );
}
