'use client';

import { GitBranch, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

import type { LedgerEntryView } from '../hooks/useRepositoryLedger';

import { Badge } from '@/components/ui/badge';

export interface RepositoryRowProps {
  entry: LedgerEntryView;
  /** true while the machine is not confirmed online. */
  disabled: boolean;
  /** true while this row's own create call is pending. */
  creating: boolean;
  onCreate: (path: string) => void;
}

const ACTION_CLASS =
  'flex h-7 w-full items-center justify-center gap-1 whitespace-nowrap border border-chatroom-border text-[10px] font-bold uppercase hover:bg-chatroom-bg-hover disabled:opacity-50';

/** The root prefix dims only when the path really starts with the root. */
function splitRootPrefix(path: string, root: string): { prefix: string; rest: string } {
  if (!path.startsWith(root)) return { prefix: '', rest: path };
  return { prefix: root, rest: path.slice(root.length) };
}

// fallow-ignore-next-line complexity
function RepositoryRowComponent({ entry, disabled, creating, onCreate }: RepositoryRowProps) {
  const { prefix, rest } = splitRootPrefix(entry.path, entry.root);
  return (
    <div
      data-testid="repository-row"
      data-has-chatroom={entry.hasChatroom}
      className="flex h-[4.5rem] items-center gap-3 border-b border-chatroom-border px-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-bold text-chatroom-text-primary">
            {entry.name}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-chatroom-text-muted">
            <GitBranch size={12} aria-hidden />
            {entry.branch ?? 'no branch'}
          </span>
        </div>
        <div
          className="truncate font-mono text-[10px]"
          title={`${entry.path}\nRoot: ${entry.root}`}
        >
          <span className="text-chatroom-text-muted">{prefix}</span>
          <span className="text-chatroom-text-primary">{rest}</span>
        </div>
      </div>
      <div className="flex w-[8.5rem] shrink-0 flex-col items-end gap-1">
        {entry.hasChatroom ? (
          <Badge
            variant="outline"
            className="rounded-none border-chatroom-status-success/40 text-[10px] uppercase text-chatroom-status-success"
          >
            Has chatroom
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="rounded-none border-chatroom-border text-[10px] uppercase text-chatroom-text-muted"
          >
            No chatroom
          </Badge>
        )}
        {entry.hasChatroom && entry.chatroomId ? (
          <Link href={`/app/chatroom?id=${entry.chatroomId}`} className={ACTION_CLASS}>
            Open
          </Link>
        ) : (
          <button
            type="button"
            disabled={disabled || creating}
            onClick={() => onCreate(entry.path)}
            className={ACTION_CLASS}
          >
            {creating ? (
              <>
                <Loader2 size={12} className="animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              'Create chatroom'
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export const RepositoryRow = memo(RepositoryRowComponent);
