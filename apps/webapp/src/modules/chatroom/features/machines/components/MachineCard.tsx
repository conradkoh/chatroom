'use client';

import React, { useMemo, useRef, useState } from 'react';

import { DeleteMachineDialog } from './DeleteMachineDialog';
import { buildMachineActions } from './machineActions';
import { MachineActionsMenu } from './MachineActionsMenu';
import { MachineAliasField } from './MachineAliasField';
import { MachineHarnessChips } from './MachineHarnessChips';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';
import type { MachineRowModel } from '../hooks/useMachineRows';
import {
  formatLastSeen,
  formatOs,
  formatRegisteredDate,
  formatUsageSummary,
} from '../lib/machineDisplay';

import { Skeleton } from '@/components/ui/skeleton';
import type { MachineUsage } from '@/hooks/useMachineUsage';

/** Connectivity dot: success (online), muted (offline), pulsing (checking). */
function MachineStatusDot({ connected }: { connected: boolean | undefined }) {
  const color =
    connected === undefined
      ? 'bg-chatroom-border-strong animate-pulse'
      : connected
        ? 'bg-chatroom-status-success'
        : 'bg-chatroom-text-muted';

  return (
    <div data-testid="machine-status-dot" aria-hidden className={`h-2.5 w-2.5 shrink-0 ${color}`} />
  );
}

function statusLabel(connected: boolean | undefined): string {
  if (connected === undefined) return 'Checking…';
  return connected ? 'Online' : 'Offline';
}

/** Offline-only "last seen" text; null means no liveness record exists. */
function LastSeenPart({ lastSeenAt }: { lastSeenAt: number | null | undefined }) {
  if (typeof lastSeenAt === 'number') {
    return (
      <span title={formatTimestampFull(lastSeenAt)}>
        last seen {formatLastSeen(lastSeenAt, Date.now())}
      </span>
    );
  }
  if (lastSeenAt === null) return <span>last seen unknown</span>;
  return null;
}

/** Usage counts: skeleton while loading, formatted text once available. */
function MachineUsageSummary({
  usage,
  className = '',
  testId,
}: {
  usage: MachineUsage | undefined;
  className?: string;
  testId: string;
}) {
  if (usage === undefined) {
    return (
      <div data-testid={testId} className={className}>
        <Skeleton className="h-3 w-28 rounded-none" />
      </div>
    );
  }

  return (
    <span data-testid={testId} className={className}>
      {formatUsageSummary(usage)}
    </span>
  );
}

/** Status, last seen, hostname, OS, registration date and (below md) usage. */
function MachineStatusLine({ row }: { row: MachineRowModel }) {
  const { machine, connected, lastSeenAt, usage } = row;

  const parts: React.ReactNode[] = [
    <span
      key="status"
      data-testid="machine-status"
      className={connected ? 'text-chatroom-status-success' : undefined}
    >
      {statusLabel(connected)}
    </span>,
  ];

  if (connected === false && lastSeenAt !== undefined) {
    parts.push(<LastSeenPart key="last-seen" lastSeenAt={lastSeenAt} />);
  }

  parts.push(<span key="hostname">{machine.hostname}</span>);
  parts.push(<span key="os">{formatOs(machine.os)}</span>);
  parts.push(<span key="registered">Registered {formatRegisteredDate(machine.registeredAt)}</span>);
  parts.push(
    <MachineUsageSummary
      key="usage"
      usage={usage}
      className="md:hidden"
      testId="machine-usage-inline"
    />
  );

  return (
    <div
      data-testid="machine-meta"
      className="flex flex-wrap gap-x-1 text-xs text-chatroom-text-muted"
    >
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span aria-hidden>·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

/** One registered machine: name/alias, live status, usage and harness chips. */
export function MachineCard({ row }: { row: MachineRowModel }) {
  const { machine } = row;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameSignal, setRenameSignal] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const actions = useMemo(
    () =>
      buildMachineActions({
        onRename: () => setRenameSignal((n) => n + 1),
        onDelete: () => setDeleteOpen(true),
      }),
    []
  );

  return (
    <li
      data-testid="machine-card"
      data-machine-id={machine.machineId}
      className="border-2 border-chatroom-border bg-chatroom-bg-surface"
    >
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <MachineStatusDot connected={row.connected} />
            <MachineAliasField
              machineId={machine.machineId}
              alias={machine.alias}
              hostname={machine.hostname}
              startEditSignal={renameSignal}
            />
          </div>
          <MachineStatusLine row={row} />
          <MachineHarnessChips machineId={machine.machineId} connected={row.connected} />
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <MachineUsageSummary
            usage={row.usage}
            className="hidden pt-2 text-xs text-chatroom-text-muted md:block"
            testId="machine-usage"
          />
          <MachineActionsMenu actions={actions} triggerRef={triggerRef} />
        </div>
      </div>
      <DeleteMachineDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        machine={{ machineId: machine.machineId, displayName: row.displayName }}
        connected={row.connected}
        usage={row.usage}
        finalFocusRef={triggerRef}
      />
    </li>
  );
}
