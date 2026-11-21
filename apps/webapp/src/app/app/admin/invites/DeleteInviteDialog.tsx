'use client';

import type { InviteSummary } from '@workspace/backend/convex/admin/invites';

import { type Feedback, InlineFeedback } from '@/components/inline-feedback';
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

type DeleteInviteDialogProps = {
  deleteTarget: InviteSummary | null;
  isDeleting: boolean;
  /** Delete failure. Rendered inside the open dialog. */
  feedback: Feedback | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function DeleteInviteDialog({
  deleteTarget,
  isDeleting,
  feedback,
  onOpenChange,
  onConfirm,
}: DeleteInviteDialogProps) {
  return (
    <AlertDialog open={deleteTarget !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete invite code?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the invite for {deleteTarget?.inviteeEmail}. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <InlineFeedback feedback={feedback} data-testid="delete-invite-feedback" className="mt-2" />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // The action is a close button; keep the dialog open so a delete failure can be
              // shown in the slot above.
              event.preventBaseUIHandler();
              onConfirm();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
