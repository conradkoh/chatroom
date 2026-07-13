'use client';

/**
 * DirectHarnessPanel — renders a direct-harness session within the explorer-split
 * right panel. Uses the chatroom's active workspace (from useChatroomActiveWorkspace)
 * so the panel always operates on the same workspace as the file explorer.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ [Session dropdown ▾]          [+ New session]  │  <- header
 *   ├────────────────────────────────────────────────┤
 *   │                                                │
 *   │  SessionDetail  OR  NewSessionComposer         │  <- body
 *   │                                                │
 *   └────────────────────────────────────────────────┘
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { NewSessionComposer } from '../direct-harness/components/SessionComposer';
import { SessionDetail } from '../direct-harness/components/SessionDetail';
import { displaySessionTitle } from '../direct-harness/components/SessionList';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from '../components/picker';
import { useRefreshCapabilities } from '../direct-harness/hooks/useRefreshCapabilities';
import { useChatroomActiveWorkspace } from '../hooks/useChatroomActiveWorkspace';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DirectHarnessPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
  /** Managed by the parent lifecycle hook — persisted per chatroom. */
  selectedSessionId: string | null;
  /** Managed by the parent lifecycle hook — persists on change. */
  setSelectedSessionId: (id: string | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DirectHarnessPanel({
  chatroomId,
  selectedSessionId,
  setSelectedSessionId,
}: DirectHarnessPanelProps) {
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
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const {
    searchTerm: sessionSearch,
    setSearchTerm: setSessionSearch,
    handleOpenChange: handleSessionOpenChange,
  } = usePickerSearchState(setSessionPickerOpen);

  // Refresh capabilities when workspace becomes known
  useEffect(() => {
    if (workspaceId) refreshCapabilities(workspaceId);
  }, [workspaceId, refreshCapabilities]);

  // Auto-select most-recent session when none persisted and sessions load
  useEffect(() => {
    if (sessions && sessions.length > 0 && selectedSessionId === null) {
      const newest = [...sessions].reverse()[0];
      if (newest) setSelectedSessionId(newest._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const typedSessionId = selectedSessionId
    ? (selectedSessionId as Id<'chatroom_harnessSessions'>)
    : null;

  // Find the summary for the selected session
  const sessionSummary = sessions?.find((s) => s._id === typedSessionId);

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

  const sessionTitle =
    typedSessionId && sessionSummary ? displaySessionTitle(sessionSummary) : null;

  const filteredSessions = filterPickerItems(sortedSessions, sessionSearch, (s) =>
    displaySessionTitle(s)
  );

  return (
    <div className="@container flex-1 flex flex-col min-h-0">
      {/* Header: session dropdown + new-session button */}
      <div className="shrink-0 border-b-2 border-border px-2 py-1.5 flex items-center gap-2">
        {sessionTitle ? (
          <span
            className="flex-1 min-w-0 truncate text-xs font-bold @md:hidden"
            title={sessionTitle}
          >
            {sessionTitle}
          </span>
        ) : null}
        <ResponsivePickerShell
          open={sessionPickerOpen}
          onOpenChange={handleSessionOpenChange}
          title={sessionTitle ? 'Change session' : 'Select session'}
          align="start"
          contentClassName="w-72"
          trigger={
            <button
              type="button"
              className={
                sessionTitle
                  ? 'h-7 w-7 shrink-0 p-0 justify-center @md:flex-1 @md:w-auto @md:px-3 @md:justify-between'
                  : 'flex-1 h-7 text-xs'
              }
              aria-label={sessionTitle ? 'Change session' : 'Select session'}
            >
              {sessionTitle ? <ChevronDown size={14} className="@md:hidden" /> : null}
              <span className={sessionTitle ? 'hidden @md:inline-flex min-w-0' : undefined}>
                {sessionTitle ?? 'Select session…'}
              </span>
            </button>
          }
        >
          <PickerSearch
            value={sessionSearch}
            onChange={setSessionSearch}
            placeholder="Search sessions…"
          />
          <PickerScrollBody maxHeightClassName="max-h-60">
            {filteredSessions.length > 0
              ? filteredSessions.map((s) => (
                  <PickerOptionRow
                    key={s._id}
                    selected={selectedSessionId === s._id}
                    onSelect={() => {
                      setSelectedSessionId(s._id);
                      handleSessionOpenChange(false);
                    }}
                  >
                    {displaySessionTitle(s)}
                  </PickerOptionRow>
                ))
              : null}
            <PickerOptionRow
              selected={selectedSessionId === null}
              onSelect={() => {
                setSelectedSessionId(null);
                handleSessionOpenChange(false);
              }}
            >
              <span className="text-muted-foreground">+ New session</span>
            </PickerOptionRow>
          </PickerScrollBody>
        </ResponsivePickerShell>

        <button
          type="button"
          onClick={() => {
            setSelectedSessionId(null);
          }}
          className="shrink-0 h-7 w-7 flex items-center justify-center border border-input bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          title="Start a new session"
          aria-label="New session"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Body: session detail or new session composer */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {typedSessionId && sessionSummary ? (
          <SessionDetail sessionRowId={typedSessionId} sessionSummary={sessionSummary} />
        ) : (
          <NewSessionComposer
            workspaceId={workspaceId}
            onSessionCreated={(id) => {
              setSelectedSessionId(id);
            }}
          />
        )}
      </div>
    </div>
  );
}
