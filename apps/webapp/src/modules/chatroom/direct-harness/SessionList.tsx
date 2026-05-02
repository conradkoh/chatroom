'use client';

/**
 * SessionList — list of harness sessions for a workspace.
 *
 * Each row shows:
 * - Colored status dot (green=active, grey=idle, red=failed, grey-X=closed)
 * - Agent name and lastActiveAt timestamp
 * - Status badge
 * - Kebab row menu: Resume (idle/closed), Close (active/idle), Delete (closed/failed)
 *
 * Clicking an idle row triggers resumeSession in the background.
 * Clicking an active row just opens the message view.
 */

import { useCallback, useState } from 'react';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { api } from '@workspace/backend/convex/_generated/api';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MoreHorizontal, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type SessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

interface SessionListProps {
  workspaceId: string;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

// ─── Status dot ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: SessionStatus }) {
  switch (status) {
    case 'active':
      return <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400 shrink-0" />;
    case 'idle':
      return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />;
    case 'failed':
      return <span className="w-2 h-2 rounded-full bg-red-500 dark:bg-red-400 shrink-0" />;
    case 'closed':
      return (
        <span className="w-2 h-2 shrink-0 flex items-center justify-center text-muted-foreground">
          <X size={8} />
        </span>
      );
    default:
      // pending/spawning
      return (
        <span className="w-2 h-2 rounded-full bg-blue-400 dark:bg-blue-400 animate-pulse shrink-0" />
      );
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function statusBadgeClass(status: SessionStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-green-500/30';
    case 'idle':
      return 'bg-muted text-muted-foreground border-border';
    case 'pending':
    case 'spawning':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/30';
    case 'closed':
      return 'bg-muted text-muted-foreground border-border';
    case 'failed':
      return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function formatRelativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionList({ workspaceId, selectedSessionId, onSelect }: SessionListProps) {
  const sessions = useSessionQuery(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
    workspaceId: workspaceId as Id<'chatroom_workspaces'>,
  });

  const resumeSessionMutation = useSessionMutation(
    api.chatroom.directHarness.prompts.resumeSession
  );
  const closeSessionMutation = useSessionMutation(
    api.chatroom.directHarness.sessions.closeSession
  );

  // Track which sessions are currently resuming (optimistic)
  const [resumingIds, setResumingIds] = useState<Set<string>>(new Set());

  const handleRowClick = useCallback(
    async (sessionId: string, status: SessionStatus) => {
      onSelect(sessionId);
      if (status === 'idle' || status === 'closed') {
        setResumingIds((prev) => new Set([...prev, sessionId]));
        try {
          await resumeSessionMutation({
            harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
          });
        } catch (err) {
          toast.error('Failed to resume session', {
            description: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setResumingIds((prev) => {
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
          });
        }
      }
    },
    [onSelect, resumeSessionMutation]
  );

  const handleResume = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setResumingIds((prev) => new Set([...prev, sessionId]));
      try {
        await resumeSessionMutation({
          harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
        });
      } catch (err) {
        toast.error('Failed to resume session', {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setResumingIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [resumeSessionMutation]
  );

  const handleClose = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await closeSessionMutation({
          harnessSessionRowId: sessionId as Id<'chatroom_harnessSessions'>,
        });
      } catch (err) {
        toast.error('Failed to close session', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [closeSessionMutation]
  );

  if (sessions !== undefined && sessions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No sessions in this workspace. Click &lsquo;New session&rsquo; to start.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium">Sessions</label>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {(sessions ?? []).map((session) => {
          const status = session.status as SessionStatus;
          const isResuming = resumingIds.has(session._id);
          return (
            <div
              key={session._id}
              className={cn(
                'group w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors cursor-pointer',
                'hover:bg-accent/50',
                selectedSessionId === session._id ? 'bg-accent text-foreground' : 'text-foreground'
              )}
              onClick={() => void handleRowClick(session._id, status)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRowClick(session._id, status); }}
            >
              <div className="flex items-center gap-1.5">
                <StatusDot status={isResuming ? 'spawning' : status} />
                <span className="font-medium truncate flex-1">{session.agent}</span>
                {isResuming && (
                  <span className="text-[10px] text-muted-foreground italic shrink-0">resuming…</span>
                )}
                {!isResuming && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1 py-0 h-4 shrink-0 border',
                      statusBadgeClass(status)
                    )}
                  >
                    {status}
                  </Badge>
                )}
                {/* Row menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-accent rounded-sm">
                      <MoreHorizontal size={12} className="text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card border-border text-xs">
                    {(status === 'idle' || status === 'closed') && (
                      <DropdownMenuItem
                        onClick={(e) => void handleResume(session._id, e)}
                        className="text-xs cursor-pointer hover:bg-accent/50"
                      >
                        Resume
                      </DropdownMenuItem>
                    )}
                    {(status === 'active' || status === 'idle') && (
                      <DropdownMenuItem
                        onClick={(e) => void handleClose(session._id, e)}
                        className="text-xs cursor-pointer hover:bg-accent/50 text-destructive"
                      >
                        Close
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="text-muted-foreground text-[10px] mt-0.5 pl-3.5">
                {formatRelativeTime(session.lastActiveAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
