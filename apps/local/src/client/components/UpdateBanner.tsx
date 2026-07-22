import { shortCommit } from '../../shared/commits';
import type { RepoUpdateStatus } from '../../shared/protocol';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function UpdateBanner({
  update,
  onApplyUpdate,
  disabled,
}: {
  update: RepoUpdateStatus;
  onApplyUpdate: () => void;
  disabled?: boolean;
}) {
  if (update.status === 'available') {
    return (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-chatroom-status-warning bg-chatroom-status-warning/10 px-4 py-2">
        <div className="min-w-0 text-xs text-chatroom-text-primary">
          <span className="font-bold uppercase tracking-wider text-chatroom-status-warning">
            Update available
          </span>
          {update.localCommit && update.remoteCommit && (
            <span className="ml-2 font-mono text-chatroom-text-muted">
              {shortCommit(update.localCommit)} → {shortCommit(update.remoteCommit)}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-none"
          onClick={onApplyUpdate}
          disabled={disabled}
        >
          Update
        </Button>
      </div>
    );
  }

  if (update.status === 'updating') {
    return (
      <div className="shrink-0 border-b-2 border-chatroom-status-info bg-chatroom-status-info/10 px-4 py-2 text-xs text-chatroom-status-info">
        Updating repository, installing dependencies, and restarting services...
      </div>
    );
  }

  if (update.status === 'error' && update.error) {
    return (
      <div
        className={cn(
          'shrink-0 border-b-2 border-chatroom-status-error bg-chatroom-status-error/10 px-4 py-2 text-xs text-chatroom-status-error'
        )}
      >
        Update failed: {update.error}
      </div>
    );
  }

  return null;
}
