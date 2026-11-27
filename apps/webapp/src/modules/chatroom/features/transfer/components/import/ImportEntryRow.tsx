'use client';

import type { ListedEntry } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';

import { chatroomLabel, omittedAttachmentsCopy, pluralize } from '../../lib/transferCopy';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

/** Industrial checkbox: sharp corners, 2px border, accent when checked or indeterminate. */
export const IMPORT_CHECKBOX_CLASS =
  'size-4 shrink-0 rounded-none border-2 border-chatroom-border-strong bg-chatroom-bg-secondary data-checked:border-chatroom-accent data-checked:bg-chatroom-accent data-checked:text-chatroom-bg-primary data-indeterminate:border-chatroom-accent data-indeterminate:bg-chatroom-accent data-indeterminate:text-chatroom-bg-primary data-disabled:opacity-50';

interface ImportEntryRowProps {
  entry: ListedEntry;
  selected: boolean;
  /** Imported in an earlier run of this file; disabled and marked. */
  imported: boolean;
  onToggle(key: string): void;
}

/** One listed chatroom: the label is the row, so clicking anywhere toggles it. */
// fallow-ignore-next-line complexity
export function ImportEntryRow({ entry, selected, imported, onToggle }: ImportEntryRowProps) {
  const ok = entry.validity.ok;
  return (
    <label
      data-testid="import-entry"
      data-key={entry.key}
      className={cn(
        'flex items-start gap-3 p-3 [content-visibility:auto] [contain-intrinsic-size:auto_84px] hover:bg-chatroom-bg-hover',
        !ok && 'cursor-not-allowed opacity-70 hover:bg-transparent'
      )}
    >
      <Checkbox
        checked={selected}
        disabled={!ok || imported}
        onCheckedChange={() => onToggle(entry.key)}
        className={cn(IMPORT_CHECKBOX_CLASS, 'mt-0.5')}
        aria-label={`Import ${chatroomLabel(entry.name)}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
            {chatroomLabel(entry.name)}
          </span>
          {entry.status && (
            <span className="border border-chatroom-border px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase text-chatroom-text-muted">
              {entry.status}
            </span>
          )}
          {imported && (
            <span className="text-[9px] font-mono font-bold uppercase text-chatroom-status-success">
              Already imported
            </span>
          )}
        </div>
        <p
          className="truncate font-mono text-[10px] text-chatroom-text-muted"
          title={entry.sourceChatroomId}
        >
          source {entry.sourceChatroomId} · team {entry.teamStructureId ?? '—'} · exported{' '}
          {formatTimestampFull(Date.parse(entry.exportedAt))}
        </p>
        {entry.counts && (
          <p className="font-mono text-[10px] tabular-nums text-chatroom-text-muted">
            {entry.counts.messages} messages · {entry.counts.tasks} tasks · {entry.counts.backlog}{' '}
            backlog · {pluralize(entry.workingDirCount ?? 0, 'working dir')}
          </p>
        )}
        {entry.omittedAttachments.count > 0 && (
          <p className="text-[10px] text-chatroom-status-warning">
            {omittedAttachmentsCopy(entry.omittedAttachments.count)}
          </p>
        )}
        {!ok && (
          <>
            <p className="font-mono text-[10px] font-bold text-chatroom-status-error">
              not importable: {entry.validity.code}
            </p>
            <p className="text-[10px] text-chatroom-text-muted">{entry.validity.message}</p>
          </>
        )}
      </div>
    </label>
  );
}
