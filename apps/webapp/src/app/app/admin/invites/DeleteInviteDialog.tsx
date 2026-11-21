'use client';

import type { InviteSummary } from '@workspace/backend/convex/admin/invites';

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
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function DeleteInviteDialog({
  deleteTarget,
  isDeleting,
  error,
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // AlertDialogAction is a base-ui Close primitive here, so a click closes the
              // dialog unless the base handler is prevented. Keep it open so a delete failure
              // shows inside it; the page closes it on success.
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
