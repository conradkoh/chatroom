'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, useCallback, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

export type LifecycleAction = 'archive';

type LifecycleImpact = { kind: 'scheduled_prompt'; count: number };

function formatImpactLine(impact: LifecycleImpact): string {
  switch (impact.kind) {
    case 'scheduled_prompt':
      return impact.count === 1
        ? '1 scheduled prompt will be disabled'
        : `${impact.count} scheduled prompts will be disabled`;
    default:
      return `${impact.count} item(s) will be affected`;
  }
}

export interface LifecycleConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId: Id<'chatroom_rooms'>;
  action: LifecycleAction;
  onConfirmed?: () => void;
}

export const LifecycleConfirmDialog = memo(function LifecycleConfirmDialog({
  open,
  onOpenChange,
  chatroomId,
  action,
  onConfirmed,
}: LifecycleConfirmDialogProps) {
  const impacts = useSessionQuery(
    api.chatrooms.getLifecycleImpacts,
    open ? { chatroomId, action } : 'skip'
  );
  const archiveChatroom = useSessionMutation(api.chatrooms.archive);
  const [isArchiving, setIsArchiving] = useState(false);

  const handleConfirm = useCallback(async () => {
    setIsArchiving(true);
    try {
      await archiveChatroom({ chatroomId });
      onOpenChange(false);
      onConfirmed?.();
    } catch (error) {
      console.error('Failed to archive chat:', error);
    } finally {
      setIsArchiving(false);
    }
  }, [archiveChatroom, chatroomId, onOpenChange, onConfirmed]);

  const impactLines = impacts?.impacts ?? [];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this chat?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-2 text-left" />}>
            {impacts === undefined ? (
              <p>Loading...</p>
            ) : impactLines.length > 0 ? (
              <>
                <p>The following will be disabled:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {impactLines.map((impact: any) => (
                    <li key={impact.kind}>{formatImpactLine(impact)}</li>
                  ))}
                </ul>
                <p>The chat will be moved to the Completed tab.</p>
              </>
            ) : (
              <p>This chat will be moved to the Completed tab. You can still view its history.</p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={isArchiving || impacts === undefined}
          >
            {isArchiving ? 'Archiving...' : 'Archive'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
