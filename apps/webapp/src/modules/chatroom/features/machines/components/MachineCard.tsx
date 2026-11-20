'use client';

import { ChevronRight } from 'lucide-react';
import React, { useCallback, useId, useMemo, useRef, useState, type RefObject } from 'react';

import { DeleteMachineDialog } from './DeleteMachineDialog';
import { buildMachineActions, type MachineAction } from './machineActions';
import { MachineActionsMenu } from './MachineActionsMenu';
import { MachineAliasField } from './MachineAliasField';
import { MachineHarnessChips } from './MachineHarnessChips';
import { MachineProjectRoots } from './MachineProjectRoots';
import { MachineRepositories } from './MachineRepositories';
import { formatTimestampFull } from '../../../utils/chatroomTimestamp';
import type { MachineRowModel } from '../hooks/useMachineRows';
import {
  formatLastSeen,
  formatOs,
  formatRegisteredDate,
  formatUsageSummary,
} from '../lib/machineDisplay';

import { Skeleton } from '@/components/ui/skeleton';
import { useMachineProjectRoots } from '@/hooks/useMachineProjectRoots';
import type { MachineUsage } from '@/hooks/useMachineUsage';
import { cn } from '@/lib/utils';

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

/** The accordion control. Fixed size, so the header never shifts when it appears. */
function MachineExpander({
  displayName,
  expanded,
  onToggle,
  bodyId,
}: {
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  bodyId: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Safari does not focus buttons on click, so collapsing restores focus explicitly.
  // Expanding never moves focus: the new body content must not steal it.
  const handleClick = useCallback(() => {
    if (expanded) ref.current?.focus();
    onToggle();
  }, [expanded, onToggle]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      aria-expanded={expanded}
      aria-controls={expanded ? bodyId : undefined}
      aria-label={`${expanded ? 'Hide' : 'Show'} details for ${displayName}`}
      data-testid="machine-expander"
      className="flex h-10 w-10 shrink-0 items-center justify-center text-chatroom-text-muted hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary sm:h-8 sm:w-8"
    >
      <ChevronRight size={16} className={cn('transition-transform', expanded && 'rotate-90')} />
    </button>
  );
}

/** Status dot, alias editor, status line and harness chips. */
function MachineIdentity({ row, renameSignal }: { row: MachineRowModel; renameSignal: number }) {
  const { machine } = row;
  return (
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
  );
}

interface MachineCardHeaderProps {
  row: MachineRowModel;
  expanded: boolean;
  onToggle: () => void;
  bodyId: string;
  actions: MachineAction[];
  menuTriggerRef: RefObject<HTMLButtonElement | null>;
  renameSignal: number;
}

function MachineCardHeader({
  row,
  expanded,
  onToggle,
  bodyId,
  actions,
  menuTriggerRef,
  renameSignal,
}: MachineCardHeaderProps) {
  return (
    <div className="flex items-start gap-2 p-3 sm:gap-3 sm:p-4">
      <MachineExpander
        displayName={row.displayName}
        expanded={expanded}
        onToggle={onToggle}
        bodyId={bodyId}
      />
      <MachineIdentity row={row} renameSignal={renameSignal} />
      <div className="flex shrink-0 items-start gap-1">
        <MachineUsageSummary
          usage={row.usage}
          className="hidden pt-2 text-xs text-chatroom-text-muted md:block"
          testId="machine-usage"
        />
        <MachineActionsMenu actions={actions} triggerRef={menuTriggerRef} />
      </div>
    </div>
  );
}

/** Expanded body: project roots, then the on-demand repository ledger. Mounted only while expanded. */
function MachineCardBody({ row, bodyId }: { row: MachineRowModel; bodyId: string }) {
  const { machine } = row;
  const { roots } = useMachineProjectRoots(machine.machineId);
  return (
    <div id={bodyId} data-testid="machine-card-body" className="border-t-2 border-chatroom-border">
      <section
        aria-label="Project roots"
        data-testid="machine-roots-section"
        className="px-4 py-4 sm:px-6"
      >
        <MachineProjectRoots
          machineId={machine.machineId}
          displayName={row.displayName}
          hostname={machine.hostname}
          alias={machine.alias}
          connected={row.connected}
        />
      </section>
      <section
        aria-label="Repositories"
        data-testid="machine-repositories-section"
        className="border-t border-chatroom-border px-4 py-4 sm:px-6"
      >
        <MachineRepositories
          machineId={machine.machineId}
          displayName={row.displayName}
          connected={row.connected}
          hasRoots={roots === undefined ? undefined : roots.length > 0}
        />
      </section>
    </div>
  );
}

/** One registered machine: name/alias, live status, usage, harness chips and the expanded body. */
export function MachineCard({
  row,
  expanded,
  onToggle,
}: {
  row: MachineRowModel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { machine } = row;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameSignal, setRenameSignal] = useState(0);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

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
      data-expanded={expanded}
      className="border-2 border-chatroom-border bg-chatroom-bg-surface"
    >
      <MachineCardHeader
        row={row}
        expanded={expanded}
        onToggle={onToggle}
        bodyId={bodyId}
        actions={actions}
        menuTriggerRef={menuTriggerRef}
        renameSignal={renameSignal}
      />
      {expanded && <MachineCardBody row={row} bodyId={bodyId} />}
      <DeleteMachineDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        machine={{ machineId: machine.machineId, displayName: row.displayName }}
        connected={row.connected}
        usage={row.usage}
        finalFocusRef={menuTriggerRef}
      />
    </li>
  );
}
