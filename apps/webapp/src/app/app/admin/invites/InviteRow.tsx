'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { InviteStatus, InviteSummary } from '@workspace/backend/convex/system/invites';
import { formatLoginCode } from '@workspace/backend/modules/auth/codeUtils';
import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUS_BADGE: Record<
  InviteStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  active: { label: 'Active', variant: 'default' },
  disabled: { label: 'Disabled', variant: 'secondary' },
  expired: { label: 'Expired', variant: 'outline' },
  used: { label: 'Used', variant: 'outline' },
};

type InviteRowProps = {
  invite: InviteSummary;
  actioningInviteId: Id<'invites'> | null;
  onDisable: (inviteId: Id<'invites'>) => void;
  onEnable: (inviteId: Id<'invites'>) => void;
  onDelete: (invite: InviteSummary) => void;
};

export function InviteRow({
  invite,
  actioningInviteId,
  onDisable,
  onEnable,
  onDelete,
}: InviteRowProps) {
  const isActioning = actioningInviteId === invite._id;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0 space-y-1">
        <p className="font-mono font-medium">{formatLoginCode(invite.code)}</p>
        <p className="text-sm">
          {invite.inviteeName} · {invite.inviteeEmail}
        </p>
        <p className="text-xs text-muted-foreground">
          Expires:{' '}
          {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Indefinite'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={STATUS_BADGE[invite.status].variant}>
          {STATUS_BADGE[invite.status].label}
        </Badge>
        {invite.status === 'active' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDisable(invite._id)}
            disabled={isActioning}
          >
            Disable
          </Button>
        )}
        {invite.status === 'disabled' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEnable(invite._id)}
            disabled={isActioning}
          >
            Enable
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(invite)}
          disabled={isActioning}
          aria-label="Delete invite"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
