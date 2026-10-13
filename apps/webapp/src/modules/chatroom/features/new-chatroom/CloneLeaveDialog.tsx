'use client';

import { useRef } from 'react';

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

/**
 * running: the clone is waiting, in progress, or stalled. completed: the folder exists but no
 * chatroom has been created from it yet.
 */
export type CloneLeaveGuard = 'running' | 'completed';

const COPY: Record<
  CloneLeaveGuard,
  { title: string; keepLabel: string; body: (hostname: string) => string }
> = {
  running: {
    title: 'Stop waiting for this clone?',
    keepLabel: 'Keep waiting',
    body: (hostname) =>
      `The clone keeps running on ${hostname}, and the folder stays on disk. No chatroom will be created from it.`,
  },
  completed: {
    title: 'Leave before creating the chatroom?',
    keepLabel: 'Stay',
    body: () => 'The cloned folder stays on disk, but no chatroom will be created from it.',
  },
};

interface CloneLeaveDialogProps {
  guard: CloneLeaveGuard;
  hostname: string;
  /** Closes the dialog and keeps the wizard open. */
  onKeep: () => void;
  /** Leaves the wizard. The clone itself is not cancelled. There is no daemon cancel command. */
  onLeave: () => void;
}

/**
 * Asks before the wizard is left while a clone is unsaved. The copy says the clone keeps running,
 * because nothing cancels it on the daemon.
 */
export function CloneLeaveDialog({ guard, hostname, onKeep, onLeave }: CloneLeaveDialogProps) {
  const copy = COPY[guard];
  // The keep button is focused on open, so Enter and Escape never leave the clone by accident.
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <AlertDialogContent initialFocus={keepRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body(hostname)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            ref={keepRef}
            variant="default"
            onClick={onKeep}
            className="bg-chatroom-status-success text-chatroom-bg-primary hover:opacity-90"
          >
            {copy.keepLabel}
          </AlertDialogAction>
          <AlertDialogCancel onClick={onLeave}>Leave</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
