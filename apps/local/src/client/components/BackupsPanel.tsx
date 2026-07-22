import type { ConvexBackupEntry, ConvexBackupStatus, RuntimeConfig } from '../../shared/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('en-US', { hour12: false });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPanel({
  backup,
  runtime,
  onCreateBackup,
  onRestoreBackup,
  onDeleteBackup,
}: {
  backup: ConvexBackupStatus;
  runtime: RuntimeConfig | null;
  onCreateBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  onDeleteBackup: (backupId: string) => void;
}) {
  const isLocalMode = runtime?.convexBackendMode === 'local';
  const busy =
    backup.status === 'creating' || backup.status === 'restoring' || backup.status === 'deleting';

  if (!isLocalMode) {
    return (
      <div className="space-y-2">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Convex Backups
        </h2>
        <p className="text-[11px] text-chatroom-text-muted">
          Backups require local Convex backend mode
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Convex Backups
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-none px-2 text-[10px]"
          onClick={onCreateBackup}
          disabled={busy}
        >
          {backup.status === 'creating' ? 'Creating...' : 'Create backup'}
        </Button>
      </div>

      {backup.error && (
        <div className="rounded-none border-2 border-chatroom-status-error px-2 py-1 text-[10px] text-chatroom-status-error">
          {backup.error}
        </div>
      )}

      {busy && (
        <div className="rounded-none border-2 border-chatroom-status-info px-2 py-1 text-[10px] text-chatroom-status-info">
          {backup.status === 'creating' && 'Creating backup...'}
          {backup.status === 'restoring' && 'Restoring backup (stack will stop and restart)...'}
          {backup.status === 'deleting' && 'Deleting backup...'}
        </div>
      )}

      {backup.backups.length === 0 && !busy && !backup.error && (
        <p className="text-[11px] text-chatroom-text-muted">No backups yet</p>
      )}

      <div className="space-y-1">
        {backup.backups.map((entry) => (
          <BackupRow
            key={entry.id}
            entry={entry}
            busy={busy}
            onRestore={onRestoreBackup}
            onDelete={onDeleteBackup}
          />
        ))}
      </div>
    </div>
  );
}

function BackupRow({
  entry,
  busy,
  onRestore,
  onDelete,
}: {
  entry: ConvexBackupEntry;
  busy: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex items-center gap-2 border-2 border-transparent p-2 transition-colors hover:border-chatroom-border-strong hover:bg-chatroom-bg-hover">
      <div className="min-w-0 flex-1 text-xs leading-snug">
        <div className="truncate font-mono text-chatroom-text-primary">{entry.filename}</div>
        <div className="text-[10px] text-chatroom-text-muted">
          {formatDate(entry.createdAt)} &middot; {formatSize(entry.sizeBytes)}
        </div>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-none px-2 text-[10px]"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `Restore backup ${entry.filename}?\n\nThis will stop the stack, import the data, and restart.`
              )
            ) {
              onRestore(entry.id);
            }
          }}
        >
          Restore
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-none px-2 text-[10px] text-chatroom-status-error"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete backup ${entry.filename}?`)) {
              onDelete(entry.id);
            }
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
