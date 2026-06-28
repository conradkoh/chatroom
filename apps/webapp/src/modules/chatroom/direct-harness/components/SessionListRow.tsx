'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionStatus } from '@workspace/backend/src/domain/direct-harness/types';
import { Square } from 'lucide-react';
import { memo, type MouseEvent } from 'react';

import { StatusDot } from './StatusDot';
import { createChatroomSelectKeyDown } from '../../components/chatroom-select-keydown';
import { relativeTime } from '../utils';
import { displaySessionTitle } from '../utils/displaySessionTitle';
import { effectiveSessionStatus, isTerminalSessionStatus } from '../utils/sessionStatus';

import { cn } from '@/lib/utils';

interface SessionListRowProps {
  session: {
    _id: Id<'chatroom_harnessSessions'>;
    status: HarnessSessionStatus;
    sessionTitle?: string | null;
    lastUsedConfig: { agent: string };
    lastActiveAt: number;
  };
  isSelected: boolean;
  optimisticallyClosedIds: ReadonlySet<string>;
  isClosing: boolean;
  onSelect: (id: Id<'chatroom_harnessSessions'>) => void;
  onClose: (e: MouseEvent, harnessSessionId: Id<'chatroom_harnessSessions'>) => void;
}

export const SessionListRow = memo(function SessionListRow({
  session,
  isSelected,
  optimisticallyClosedIds,
  isClosing,
  onSelect,
  onClose,
}: SessionListRowProps) {
  const label = displaySessionTitle(session);
  const displayStatus = effectiveSessionStatus(
    session.status,
    session._id,
    optimisticallyClosedIds
  );
  const canClose = !isTerminalSessionStatus(displayStatus);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session._id)}
      onKeyDown={createChatroomSelectKeyDown(() => onSelect(session._id))}
      className={cn(
        'w-full cursor-pointer text-left px-3 py-2 flex items-start gap-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40 text-foreground'
      )}
    >
      <StatusDot status={displayStatus} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
          {relativeTime(session.lastActiveAt)}
        </span>
      </div>
      {canClose ? (
        <button
          type="button"
          onClick={(e) => void onClose(e, session._id)}
          title="Stop session"
          disabled={isClosing}
          className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <Square size={8} fill="currentColor" />
        </button>
      ) : null}
    </div>
  );
});
