'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';

import { getConvexErrorCode, getMachineErrorCopy } from '../lib/machineErrorCopy';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteMachine } from '@/hooks/useDeleteMachine';
import type { MachineUsage } from '@/hooks/useMachineUsage';
import { CopyButton } from '@/modules/chatroom/components/CopyButton';

const DAEMON_STOP_COMMAND = 'chatroom machine daemon stop';

const SECTION_HEADING_CLASSES =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

const DELETE_FALLBACK_COPY = 'Could not delete the machine. Try again.';

const REMOVED_ITEMS = [
  'Registration, capabilities and status',
  'Cached workspace data and pending commands',
  'Project roots and repository ledger',
];

const NOT_AFFECTED_ITEMS = [
  'Chatrooms and their message history are kept',
  'Files on the computer are untouched',
];

export interface DeleteMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: { machineId: string; displayName: string };
  /** undefined = connectivity still loading (treated as "not yet known": confirm disabled). */
  connected: boolean | undefined;
  /** undefined = usage still loading. */
  usage: MachineUsage | undefined;
  /** Element to refocus when the dialog closes (the card's "Machine actions" trigger). */
  finalFocusRef?: React.RefObject<HTMLElement | null>;
}

/** "1 workspace", "2 workspaces"; capped counts are lower bounds and always plural. */
function countLabel(count: number, singular: string, plural: string, capped: boolean): string {
  return `${count}${capped ? '+' : ''} ${count === 1 && !capped ? singular : plural}`;
}

/** Detach line for the confirmation body. */
function formatDetachedLine(usage: MachineUsage): string {
  if (usage.activeWorkspaceCount === 0) return 'No chatrooms are linked to this machine.';

  const workspaces = countLabel(
    usage.activeWorkspaceCount,
    'workspace link',
    'workspace links',
    usage.capped
  );
  const chatrooms = countLabel(usage.activeChatroomCount, 'chatroom', 'chatrooms', usage.capped);
  return `${workspaces}, detached from ${chatrooms}`;
}

/** Maps a failed delete to the two recovery shapes: the blocked body, or an inline message. */
function handleDeleteFailure(
  error: unknown,
  handlers: {
    onOnline(): void;
    onInline(message: string): void;
  }
): void {
  if (getConvexErrorCode(error) === 'MACHINE_ONLINE') {
    handlers.onOnline();
    return;
  }
  // MACHINE_NOT_FOUND maps to its own copy inside getMachineErrorCopy; other failures use the fallback.
  handlers.onInline(getMachineErrorCopy(error, DELETE_FALLBACK_COPY));
}

/** Online variant: explains the guard, offers the stop command, no destructive action. */
function BlockedDeleteBody({
  displayName,
  cancelRef,
}: {
  displayName: string;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Can&apos;t delete an online machine</AlertDialogTitle>
        <AlertDialogDescription
          render={<div data-testid="delete-machine-blocked" className="space-y-3 text-left" />}
        >
          <div className="flex items-start gap-2 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 p-3 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-chatroom-status-warning" />
            <p>“{displayName}” is online. A running daemon would re-register itself.</p>
          </div>
          <p>Stop the daemon and wait until it shows offline, then delete the machine.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1.5 font-mono text-xs text-chatroom-status-success">
              {DAEMON_STOP_COMMAND}
            </code>
            <CopyButton
              text={DAEMON_STOP_COMMAND}
              label="Copy"
              copiedLabel="Copied!"
              variant="compact"
            />
          </div>
          <p className="text-xs text-chatroom-text-muted">
            If the daemon crashed or the computer went to sleep, it can keep showing online for up
            to 30 minutes.
          </p>
          <p className="text-xs text-chatroom-text-muted">
            This dialog switches to the delete confirmation as soon as the machine goes offline.
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel ref={cancelRef}>Close</AlertDialogCancel>
      </AlertDialogFooter>
    </>
  );
}

/** One headed bullet group in the consequence list. */
function ConsequenceSection({ heading, items }: { heading: string; items: string[] }) {
  return (
    <section className="space-y-1">
      <h3 className={SECTION_HEADING_CLASSES}>{heading}</h3>
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** Detach counts: skeleton while usage loads, then counts with an explanatory note. */
function DetachedSection({ usage }: { usage: MachineUsage | undefined }) {
  if (usage === undefined) {
    return (
      <section className="space-y-1" data-testid="delete-machine-usage">
        <h3 className={SECTION_HEADING_CLASSES}>Will be detached</h3>
        <Skeleton className="h-4 w-64 rounded-none" />
      </section>
    );
  }

  const hasWorkspaces = usage.activeWorkspaceCount > 0;
  return (
    <section className="space-y-1" data-testid="delete-machine-usage">
      <h3 className={SECTION_HEADING_CLASSES}>Will be detached</h3>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>{formatDetachedLine(usage)}</li>
      </ul>
      {hasWorkspaces && (
        <p className="text-xs text-chatroom-text-muted">
          They show “no workspace” until you attach a workspace on another machine.
        </p>
      )}
    </section>
  );
}

/** Inline retryable error line for the confirm body. */
function ConfirmDeleteError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      data-testid="delete-machine-error"
      role="alert"
      className="border border-chatroom-status-error/40 bg-chatroom-status-error/10 p-3 text-xs text-chatroom-status-error"
    >
      {error}
    </div>
  );
}

/** Cancel (initial focus) plus the guarded destructive action. */
function ConfirmDeleteFooter({
  pending,
  canConfirm,
  cancelRef,
  onConfirm,
}: {
  pending: boolean;
  canConfirm: boolean;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel ref={cancelRef} disabled={pending}>
        Cancel
      </AlertDialogCancel>
      <AlertDialogAction
        data-testid="delete-machine-confirm"
        disabled={!canConfirm}
        onClick={(e) => {
          // Keep the dialog open: the mutation decides between success, a live
          // online flip, and a retryable inline error.
          e.preventDefault();
          e.preventBaseUIHandler();
          onConfirm();
        }}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" size={14} /> Deleting…
          </>
        ) : (
          'Delete machine'
        )}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

/** Offline variant: consequences, detach counts, inline error and the destructive action. */
function ConfirmDeleteBody({
  displayName,
  usage,
  pending,
  canConfirm,
  error,
  cancelRef,
  onConfirm,
}: {
  displayName: string;
  usage: MachineUsage | undefined;
  pending: boolean;
  canConfirm: boolean;
  error: string | null;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{displayName}”?</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <p>This removes the machine from your account. Offline machines only.</p>
          <div data-testid="delete-machine-confirm-body" className="space-y-3">
            <ConsequenceSection heading="Will be removed" items={REMOVED_ITEMS} />
            <DetachedSection usage={usage} />
            <ConsequenceSection heading="Not affected" items={NOT_AFFECTED_ITEMS} />
            <p>To use this computer again, run the daemon there to register it as a new machine.</p>
          </div>
          <ConfirmDeleteError error={error} />
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ConfirmDeleteFooter
        pending={pending}
        canConfirm={canConfirm}
        cancelRef={cancelRef}
        onConfirm={onConfirm}
      />
    </>
  );
}

/** Dialog shell: owns the controlled root and the focus contract. */
function DeleteDialogShell({
  open,
  pending,
  onOpenChange,
  finalFocusRef,
  cancelRef,
  children,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocusRef?: React.RefObject<HTMLElement | null>;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // A pending delete is not dismissable: Escape and the backdrop are ignored.
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent
        data-testid="delete-machine-dialog"
        initialFocus={cancelRef}
        finalFocus={finalFocusRef}
      >
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Chooses the live variant: blocked for online/ server-rejected machines, confirm otherwise. */
function DeleteDialogBody({
  displayName,
  blocked,
  usage,
  pending,
  canConfirm,
  error,
  cancelRef,
  onConfirm,
}: {
  displayName: string;
  blocked: boolean;
  usage: MachineUsage | undefined;
  pending: boolean;
  canConfirm: boolean;
  error: string | null;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
}) {
  if (blocked) return <BlockedDeleteBody displayName={displayName} cancelRef={cancelRef} />;
  return (
    <ConfirmDeleteBody
      displayName={displayName}
      usage={usage}
      pending={pending}
      canConfirm={canConfirm}
      error={error}
      cancelRef={cancelRef}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Owner-facing delete flow for one machine.
 *
 * The variant follows the live row: `connected === true` (or a server MACHINE_ONLINE
 * rejection) renders the blocked body, everything else shows the confirm body. The
 * destructive action only enables once connectivity is known-offline and usage has
 * loaded; the server remains authoritative.
 * A server MACHINE_ONLINE rejection keeps the blocked body until connectivity next
 * transitions to offline.
 */
// The dialog controller is deliberately one function: its transient state, the
// rejection guard and the mutation handler read as a single unit, and splitting it
// would add a hook boundary for four lines of derived state. Pre-existing size
// finding, surfaced because this slice touches the file.
// fallow-ignore-next-line complexity
export function DeleteMachineDialog({
  open,
  onOpenChange,
  machine,
  connected,
  usage,
  finalFocusRef,
}: DeleteMachineDialogProps) {
  const deleteMachine = useDeleteMachine();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSaysOnline, setServerSaysOnline] = useState(false);
  const [prevConnected, setPrevConnected] = useState(connected);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // A server MACHINE_ONLINE rejection holds the blocked body only until connectivity
  // next transitions to offline. Render-phase reset keeps this out of an effect.
  if (prevConnected !== connected) {
    setPrevConnected(connected);
    if (connected === false) setServerSaysOnline(false);
  }

  // Reset transient state whenever the dialog toggles so a reopen starts clean.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setError(null);
        setServerSaysOnline(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleConfirm = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await deleteMachine({ machineId: machine.machineId });
      // Success and already-deleted both close silently: the row leaving the list is the signal.
      handleOpenChange(false);
    } catch (err) {
      handleDeleteFailure(err, {
        onOnline: () => setServerSaysOnline(true),
        onInline: setError,
      });
    } finally {
      setPending(false);
    }
  }, [deleteMachine, handleOpenChange, machine.machineId, pending]);

  return (
    <DeleteDialogShell
      open={open}
      pending={pending}
      onOpenChange={handleOpenChange}
      finalFocusRef={finalFocusRef}
      cancelRef={cancelRef}
    >
      <DeleteDialogBody
        displayName={machine.displayName}
        blocked={connected === true || serverSaysOnline}
        usage={usage}
        pending={pending}
        // The confirm action must never be available unless connectivity is known-offline.
        canConfirm={connected === false && usage !== undefined && !pending}
        error={error}
        cancelRef={cancelRef}
        onConfirm={() => void handleConfirm()}
      />
    </DeleteDialogShell>
  );
}
