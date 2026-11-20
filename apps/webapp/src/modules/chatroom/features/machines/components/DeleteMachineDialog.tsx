'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

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

/** The deleted branch of `machines.deleteMachine`'s result. */
interface DeletedMachineResult {
  purgeComplete: boolean;
  detachedWorkspaceCount: number;
  affectedChatroomCount: number;
}

function plural(count: number, unit: 'workspace' | 'chatroom'): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** Success toast: what was detached, plus a background-purge note when applicable. */
function formatDeletedToast(displayName: string, result: DeletedMachineResult): string {
  const detached =
    result.detachedWorkspaceCount === 0
      ? ''
      : ` ${plural(result.detachedWorkspaceCount, 'workspace')} detached from ${plural(
          result.affectedChatroomCount,
          'chatroom'
        )}.`;
  const purge = result.purgeComplete
    ? ''
    : ' Remaining data is being cleaned up in the background.';
  return `Deleted "${displayName}".${detached}${purge}`;
}

/**
 * Detach line for the confirmation body. `capped` counts are lower bounds, so they
 * always read as plural ("500+ workspace links").
 */
function formatDetachedLine(usage: MachineUsage): string {
  if (usage.activeWorkspaceCount === 0) return 'No chatrooms are linked to this machine.';

  const plus = usage.capped ? '+' : '';
  const workspaces = `${usage.activeWorkspaceCount}${plus} ${
    usage.activeWorkspaceCount === 1 && !usage.capped ? 'workspace link' : 'workspace links'
  }`;
  const chatrooms = `${usage.activeChatroomCount}${plus} chatroom${
    usage.activeChatroomCount === 1 && !usage.capped ? '' : 's'
  }`;
  return `${workspaces}, detached from ${chatrooms}`;
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
  const detachedLine = usage === undefined ? null : formatDetachedLine(usage);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{displayName}”?</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <p>This removes the machine from your account. Offline machines only.</p>
          <div data-testid="delete-machine-confirm-body" className="space-y-3">
            <section className="space-y-1">
              <h3 className={SECTION_HEADING_CLASSES}>Will be removed</h3>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>Registration, capabilities and status</li>
                <li>Cached workspace data and pending commands</li>
                <li>Project roots and repository ledger</li>
              </ul>
            </section>
            <section className="space-y-1" data-testid="delete-machine-usage">
              <h3 className={SECTION_HEADING_CLASSES}>Will be detached</h3>
              {detachedLine === null ? (
                <Skeleton className="h-4 w-64 rounded-none" />
              ) : (
                <div className="space-y-1">
                  <ul className="list-disc space-y-0.5 pl-5">
                    <li>{detachedLine}</li>
                  </ul>
                  {usage !== undefined && usage.activeWorkspaceCount > 0 && (
                    <p className="text-xs text-chatroom-text-muted">
                      They show “no workspace” until you attach a workspace on another machine.
                    </p>
                  )}
                </div>
              )}
            </section>
            <section className="space-y-1">
              <h3 className={SECTION_HEADING_CLASSES}>Not affected</h3>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>Chatrooms and their message history are kept</li>
                <li>Files on the computer are untouched</li>
              </ul>
            </section>
            <p>To use this computer again, run the daemon there to register it as a new machine.</p>
          </div>
          {error && (
            <div
              data-testid="delete-machine-error"
              role="alert"
              className="border border-chatroom-status-error/40 bg-chatroom-status-error/10 p-3 text-xs text-chatroom-status-error"
            >
              {error}
            </div>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
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
    </>
  );
}

/**
 * Owner-facing delete flow for one machine.
 *
 * The variant follows the live row: `connected === true` (or a server MACHINE_ONLINE
 * rejection) renders the blocked body, everything else shows the confirm body. The
 * destructive action only enables once connectivity is known-offline and usage has
 * loaded; the server remains authoritative.
 */
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
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset transient state on close so a reopened dialog always starts clean.
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
      const result = await deleteMachine({ machineId: machine.machineId });
      handleOpenChange(false);
      if (result.status === 'already_deleted') {
        toast('This machine was already deleted.');
        return;
      }
      toast.success(formatDeletedToast(machine.displayName, result));
    } catch (err) {
      const code = getConvexErrorCode(err);
      if (code === 'MACHINE_ONLINE') {
        setServerSaysOnline(true);
      } else if (code === 'MACHINE_NOT_FOUND') {
        handleOpenChange(false);
        toast.error(getMachineErrorCopy(err, 'This machine no longer exists.'));
      } else {
        setError(getMachineErrorCopy(err, DELETE_FALLBACK_COPY));
      }
    } finally {
      setPending(false);
    }
  }, [deleteMachine, handleOpenChange, machine.displayName, machine.machineId, pending]);

  const blocked = connected === true || serverSaysOnline;
  // The confirm action must never be available unless connectivity is known-offline.
  const canConfirm = connected === false && usage !== undefined && !pending;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) handleOpenChange(next);
      }}
    >
      <AlertDialogContent
        data-testid="delete-machine-dialog"
        initialFocus={cancelRef}
        finalFocus={finalFocusRef}
      >
        {blocked ? (
          <BlockedDeleteBody displayName={machine.displayName} cancelRef={cancelRef} />
        ) : (
          <ConfirmDeleteBody
            displayName={machine.displayName}
            usage={usage}
            pending={pending}
            canConfirm={canConfirm}
            error={error}
            cancelRef={cancelRef}
            onConfirm={() => void handleConfirm()}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
