'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo } from 'react';

import { StandingInstructionsPresetUsageDetails } from './StandingInstructionsPresetUsageDetails';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';

export interface StandingInstructionsSharedEditConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetId: Id<'chatroom_standingInstructionHistory'>;
  onConfirmed: () => void;
}

/**
 * Confirmation shown before editing a shared preset that is used in multiple
 * chatrooms. Displays the active/inactive usage breakdown so the user knows the
 * edit will propagate everywhere.
 */
export const StandingInstructionsSharedEditConfirmDialog = memo(
  function StandingInstructionsSharedEditConfirmDialog({
    open,
    onOpenChange,
    presetId,
    onConfirmed,
  }: StandingInstructionsSharedEditConfirmDialogProps) {
    const usage = useSessionQuery(
      api.standingInstructions.getPresetUsage,
      open ? { presetId } : 'skip'
    );

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit shared preset?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <StandingInstructionsPresetUsageDetails usage={usage} variant="edit" />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmed}>Continue editing</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);
