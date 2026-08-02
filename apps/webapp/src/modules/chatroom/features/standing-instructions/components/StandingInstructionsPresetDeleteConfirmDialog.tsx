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

export interface StandingInstructionsPresetDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetId: Id<'chatroom_standingInstructionHistory'>;
  onConfirmed: () => void | Promise<void>;
}

/**
 * Destructive confirmation before deleting a preset from the history library.
 * Shows the usage breakdown and warns that every linked chatroom will lose its
 * standing instructions.
 */
// fallow-ignore-next-line unused-export
export const StandingInstructionsPresetDeleteConfirmDialog = memo(
  function StandingInstructionsPresetDeleteConfirmDialog({
    open,
    onOpenChange,
    presetId,
    onConfirmed,
  }: StandingInstructionsPresetDeleteConfirmDialogProps) {
    const usage = useSessionQuery(
      api.standingInstructions.getPresetUsage,
      open ? { presetId } : 'skip'
    );

    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete preset?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <StandingInstructionsPresetUsageDetails usage={usage} variant="delete" />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onConfirmed();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);
