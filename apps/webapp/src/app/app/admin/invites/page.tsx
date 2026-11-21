'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/admin/invites';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { CreateInviteCard } from '@/app/app/admin/invites/CreateInviteCard';
import { DeleteInviteDialog } from '@/app/app/admin/invites/DeleteInviteDialog';
import { InviteListCard } from '@/app/app/admin/invites/InviteListCard';
import { InlineFeedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';
import { getErrorMessage } from '@/lib/convexError';

export default function InvitesPage() {
  const invites = useSessionQuery(api.admin.invites.listInvites);
  const createInvite = useSessionMutation(api.admin.invites.createInvite);
  const disableInvite = useSessionMutation(api.admin.invites.disableInvite);
  const enableInvite = useSessionMutation(api.admin.invites.enableInvite);
  const deleteInvite = useSessionMutation(api.admin.invites.deleteInvite);

  const [actioningInviteId, setActioningInviteId] = useState<Id<'invites'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InviteSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    feedback: listFeedback,
    error: reportListError,
    clear: clearListFeedback,
  } = useFeedback();
  const {
    feedback: deleteFeedback,
    error: reportDeleteError,
    clear: clearDeleteFeedback,
  } = useFeedback();

  const handleCreate = useCallback(
    (input: Parameters<typeof createInvite>[0]) => createInvite(input),
    [createInvite]
  );

  const handleDisable = useCallback(
    async (inviteId: Id<'invites'>) => {
      clearListFeedback();
      setActioningInviteId(inviteId);
      try {
        await disableInvite({ inviteId });
      } catch (error) {
        reportListError(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [disableInvite, clearListFeedback, reportListError]
  );

  const handleEnable = useCallback(
    async (inviteId: Id<'invites'>) => {
      clearListFeedback();
      setActioningInviteId(inviteId);
      try {
        await enableInvite({ inviteId });
      } catch (error) {
        reportListError(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [enableInvite, clearListFeedback, reportListError]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    clearDeleteFeedback();
    setIsDeleting(true);
    try {
      await deleteInvite({ inviteId: deleteTarget._id });
      setDeleteTarget(null);
    } catch (error) {
      reportDeleteError(getErrorMessage(error, 'Operation failed'));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteInvite, deleteTarget, clearDeleteFeedback, reportDeleteError]);

  return (
    <div className="pt-6 space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">Invites</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Manage invite codes for controlled sign-ups
          </p>
        </div>
        <CreateInviteCard onCreate={handleCreate} />
      </div>

      <InlineFeedback
        feedback={listFeedback}
        onDismiss={clearListFeedback}
        data-testid="invites-feedback"
      />

      <InviteListCard
        invites={invites}
        actioningInviteId={actioningInviteId}
        onDisable={handleDisable}
        onEnable={handleEnable}
        onDelete={setDeleteTarget}
      />

      <DeleteInviteDialog
        deleteTarget={deleteTarget}
        isDeleting={isDeleting}
        feedback={deleteFeedback}
        onOpenChange={(open) => {
          if (open) return;
          setDeleteTarget(null);
          clearDeleteFeedback();
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
