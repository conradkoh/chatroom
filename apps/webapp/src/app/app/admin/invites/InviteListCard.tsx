'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteSummary } from '@workspace/backend/convex/admin/invites';
import { Ticket } from 'lucide-react';

import { AdminListSkeleton } from '@/app/app/admin/AdminListSkeleton';
import { InviteRow } from '@/app/app/admin/invites/InviteRow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type InviteListCardProps = {
  invites: InviteSummary[] | undefined;
  actioningInviteId: Id<'invites'> | null;
  onDisable: (inviteId: Id<'invites'>) => void;
  onEnable: (inviteId: Id<'invites'>) => void;
  onDelete: (invite: InviteSummary) => void;
};

export function InviteListCard({
  invites,
  actioningInviteId,
  onDisable,
  onEnable,
  onDelete,
}: InviteListCardProps) {
  const isLoading = invites === undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ticket className="h-5 w-5" />
          All Invites
        </CardTitle>
        <CardDescription>View and manage existing invite codes</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <AdminListSkeleton itemClassName="h-20 w-full" />
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invites yet.</p>
        ) : (
          <div className="space-y-3">
            {invites.map((invite) => (
              <InviteRow
                key={invite._id}
                invite={invite}
                actioningInviteId={actioningInviteId}
                onDisable={onDisable}
                onEnable={onEnable}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
