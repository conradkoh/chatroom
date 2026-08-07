'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/system/invites';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/app/app/admin/convexError';
import { CreateInviteCard } from '@/app/app/admin/invites/CreateInviteCard';
import { DeleteInviteDialog } from '@/app/app/admin/invites/DeleteInviteDialog';
import { InviteListCard } from '@/app/app/admin/invites/InviteListCard';

export default function InvitesPage() {
  const invites = useSessionQuery(api.system.invites.listInvites);
  const createInvite = useSessionMutation(api.system.invites.createInvite);
  const disableInvite = useSessionMutation(api.system.invites.disableInvite);
  const enableInvite = useSessionMutation(api.system.invites.enableInvite);
  const deleteInvite = useSessionMutation(api.system.invites.deleteInvite);

  const [actioningInviteId, setActioningInviteId] = useState<Id<'invites'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InviteSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreate = useCallback(
    (input: Parameters<typeof createInvite>[0]) => createInvite(input),
    [createInvite]
  );

  const handleDisable = useCallback(
    async (inviteId: Id<'invites'>) => {
      setActioningInviteId(inviteId);
      try {
        await disableInvite({ inviteId });
        toast.success('Invite disabled');
      } catch (error) {
        toast.error(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [disableInvite]
  );

  const handleEnable = useCallback(
    async (inviteId: Id<'invites'>) => {
      setActioningInviteId(inviteId);
      try {
        await enableInvite({ inviteId });
        toast.success('Invite enabled');
      } catch (error) {
        toast.error(getErrorMessage(error, 'Operation failed'));
      } finally {
        setActioningInviteId(null);
      }
    },
    [enableInvite]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteInvite({ inviteId: deleteTarget._id });
      toast.success('Invite deleted');
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Operation failed'));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteInvite, deleteTarget]);

  return (
    <div className="pt-6 space-y-4 md:space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold">Invites</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Manage invite codes for controlled sign-ups
        </p>
      </div>

      <CreateInviteCard onCreate={handleCreate} />

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
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
