'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/admin/invites';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertCircle } from 'lucide-react';
import { useCallback, useState } from 'react';

import { getErrorMessage } from '@/app/app/admin/convexError';
import { CreateInviteCard } from '@/app/app/admin/invites/CreateInviteCard';
import { DeleteInviteDialog } from '@/app/app/admin/invites/DeleteInviteDialog';
import { InviteListCard } from '@/app/app/admin/invites/InviteListCard';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function InvitesPage() {
  const invites = useSessionQuery(api.admin.invites.listInvites);
  const createInvite = useSessionMutation(api.admin.invites.createInvite);
  const disableInvite = useSessionMutation(api.admin.invites.disableInvite);
  const enableInvite = useSessionMutation(api.admin.invites.enableInvite);
  const deleteInvite = useSessionMutation(api.admin.invites.deleteInvite);

  const [actioningInviteId, setActioningInviteId] = useState<Id<'invites'> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InviteSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = useCallback(
    (input: Parameters<typeof createInvite>[0]) => createInvite(input),
    [createInvite]
  );

  const handleDisable = useCallback(
    async (inviteId: Id<'invites'>) => {
      setListError(null);
      setActioningInviteId(inviteId);
      try {
        await disableInvite({ inviteId });
      } catch (error) {
        setListError(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [disableInvite]
  );

  const handleEnable = useCallback(
    async (inviteId: Id<'invites'>) => {
      setListError(null);
      setActioningInviteId(inviteId);
      try {
        await enableInvite({ inviteId });
      } catch (error) {
        setListError(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [enableInvite]
  );

  const handleDeleteRequest = useCallback((invite: InviteSummary) => {
    setDeleteError(null);
    setDeleteTarget(invite);
  }, []);

  const handleDeleteOpenChange = useCallback(
    (open: boolean) => {
      // Ignore close requests (Escape, overlay click) while the delete is in flight so the
      // failure message stays visible. Cancel is disabled for the same reason.
      if (open || isDeleting) return;
      setDeleteError(null);
      setDeleteTarget(null);
    },
    [isDeleting]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await deleteInvite({ inviteId: deleteTarget._id });
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(getErrorMessage(error, 'Operation failed'));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteInvite, deleteTarget]);

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

      {listError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      )}

      <InviteListCard
        invites={invites}
        actioningInviteId={actioningInviteId}
        onDisable={handleDisable}
        onEnable={handleEnable}
        onDelete={handleDeleteRequest}
      />

      <DeleteInviteDialog
        deleteTarget={deleteTarget}
        isDeleting={isDeleting}
        error={deleteError}
        onOpenChange={handleDeleteOpenChange}
        onConfirm={handleDelete}
      />
    </div>
  );
}
