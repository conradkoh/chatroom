'use client';

/**
 * DirectHarnessPanel — renders a direct-harness session within the explorer-split
 * right panel. Uses the chatroom's active workspace (from useChatroomActiveWorkspace)
 * so the panel always operates on the same workspace as the file explorer.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ [Session dropdown ▾]          [+ New session] │  <- header
 *   ├────────────────────────────────────────────────┤
 *   │                                                │
 *   │  SessionDetail  OR  NewSessionComposer         │  <- body
 *   │                                                │
 *   └────────────────────────────────────────────────┘
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../direct-harness/components/ui/select';
import { SessionDetail } from '../direct-harness/components/SessionDetail';
import { NewSessionComposer } from '../direct-harness/components/SessionComposer';
import { displaySessionTitle } from '../direct-harness/components/SessionList';
import { useRefreshCapabilities } from '../direct-harness/hooks/useRefreshCapabilities';
import { useChatroomActiveWorkspace } from '../hooks/useChatroomActiveWorkspace';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const SELECTED_SESSION_KEY = (chatroomId: string) =>
  `chatroom:${chatroomId}:harnessPanel:selectedSessionId`;

function readSelectedSession(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSelectedSession(key: string, id: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (id === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, id);
    }
  } catch {
    // ignore
  }
}

// ─── Sentinel for "new session" pane ─────────────────────────────────────────

const NEW_SESSION_VALUE = '__new__';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DirectHarnessPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DirectHarnessPanel({ chatroomId }: DirectHarnessPanelProps) {
  const { activeWorkspace } = useChatroomActiveWorkspace(chatroomId);

  // workspaceId is the Convex _id of the active workspace (string here, cast to Id when needed)
  const workspaceId = activeWorkspace?.workspaceId
    ? (activeWorkspace.workspaceId as Id<'chatroom_workspaces'>)
    : null;

  const sessions = useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );

  const { refresh: refreshCapabilities } = useRefreshCapabilities();

  // Refresh capabilities when workspace becomes known
  useEffect(() => {
    if (workspaceId) refreshCapabilities(workspaceId);
  }, [workspaceId, refreshCapabilities]);

  // Persist selected session per chatroom
  const sessionKey = SELECTED_SESSION_KEY(chatroomId as string);
  const [selectedSessionId, setSelectedSessionIdState] =
    useState<Id<'chatroom_harnessSessions'> | null>(() => {
      const stored = readSelectedSession(sessionKey);
      return stored ? (stored as Id<'chatroom_harnessSessions'>) : null;
    });

  // Auto-select most-recent session when none persisted and sessions load
  useEffect(() => {
    if (sessions && sessions.length > 0 && selectedSessionId === null) {
      const newest = [...sessions].reverse()[0];
      if (newest) setSelectedSessionId(newest._id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const setSelectedSessionId = useCallback(
    (id: Id<'chatroom_harnessSessions'> | null) => {
      setSelectedSessionIdState(id);
      writeSelectedSession(sessionKey, id);
    },
    [sessionKey]
  );

  // Find the summary for the selected session
  const sessionSummary = sessions?.find((s) => s._id === selectedSessionId);

  // Dropdown current value
  const dropdownValue = selectedSessionId ?? NEW_SESSION_VALUE;

  // ─── No workspace ────────────────────────────────────────────────────────────

  if (!workspaceId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-xs text-muted-foreground">
          No workspace registered for this chatroom — switch to Explorer to register one.
        </p>
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  const sortedSessions = sessions ? [...sessions].reverse() : [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header: session dropdown + new-session button */}
      <div className="shrink-0 border-b-2 border-border px-2 py-1.5 flex items-center gap-2">
        <Select
          value={dropdownValue}
          onValueChange={(val) => {
            if (val === NEW_SESSION_VALUE) {
              setSelectedSessionId(null);
            } else {
              setSelectedSessionId(val as Id<'chatroom_harnessSessions'>);
            }
          }}
        >
          <SelectTrigger className="flex-1 h-7 text-xs">
            <SelectValue placeholder="Select session…" />
          </SelectTrigger>
          <SelectContent>
            {sortedSessions.map((s) => (
              <SelectItem key={s._id} value={s._id} className="text-xs">
                {displaySessionTitle(s)}
              </SelectItem>
            ))}
            <SelectItem value={NEW_SESSION_VALUE} className="text-xs text-muted-foreground">
              + New session
            </SelectItem>
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => setSelectedSessionId(null)}
          className="shrink-0 h-7 w-7 flex items-center justify-center border border-input bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          title="Start a new session"
          aria-label="New session"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Body: session detail or new session composer */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedSessionId && sessionSummary ? (
          <SessionDetail
            sessionRowId={selectedSessionId}
            sessionSummary={sessionSummary}
          />
        ) : (
          <NewSessionComposer
            workspaceId={workspaceId}
            onSessionCreated={(id) => setSelectedSessionId(id)}
          />
        )}
      </div>
    </div>
  );
}
