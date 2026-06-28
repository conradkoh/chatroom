'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { ChevronLeft, MonitorOff, Plus, SquarePen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { HarnessWorkspaceSwitcher } from './HarnessWorkspaceSwitcher';
import { NewSessionComposer } from './SessionComposer';
import { SessionDetail } from './SessionDetail';
import { SessionList } from './SessionList';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useOptimisticSessionClose } from '../hooks/useOptimisticSessionClose';
import { useRefreshCapabilities } from '../hooks/useRefreshCapabilities';
import { effectiveSessionStatus } from '../utils/sessionStatus';

import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

// ─── SelectedSessionDetail ────────────────────────────────────────────────────

function SelectedSessionDetail({
  selectedSessionId,
  workspaceId,
  optimisticallyClosedIds,
}: {
  selectedSessionId: Id<'chatroom_harnessSessions'>;
  workspaceId: Id<'chatroom_workspaces'> | null;
  optimisticallyClosedIds: ReadonlySet<string>;
}) {
  const sessions = useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );
  const sessionSummary = sessions?.find((s) => s._id === selectedSessionId);

  if (!sessionSummary) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const displaySummary = {
    ...sessionSummary,
    status: effectiveSessionStatus(
      sessionSummary.status,
      sessionSummary._id,
      optimisticallyClosedIds
    ),
  };

  return <SessionDetail sessionRowId={selectedSessionId} sessionSummary={displaySummary} />;
}

// ─── DirectHarnessView ────────────────────────────────────────────────────────

export const DirectHarnessView = memo(function DirectHarnessView({
  chatroomId,
}: DirectHarnessViewProps) {
  const workspaces = useSessionQuery(api.workspaces.listWorkspacesForChatroom, { chatroomId });
  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const registerWorkspace = useSessionMutation(api.workspaces.registerWorkspace);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<'chatroom_workspaces'> | null>(
    null
  );
  // null = existing session selected; undefined = new session pane open
  const [selectedSessionId, setSelectedSessionId] = useState<
    Id<'chatroom_harnessSessions'> | null | undefined
  >(undefined);

  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [registerMachineId, setRegisterMachineId] = useState('');
  const [registerWorkingDir, setRegisterWorkingDir] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

  const { refresh: refreshCapabilities } = useRefreshCapabilities();

  const workspaceSessions = useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : 'skip'
  );
  const { optimisticallyClosedIds, closingIds, closeSession } =
    useOptimisticSessionClose(workspaceSessions);

  const machines = machinesResult?.machines ?? [];

  // Auto-select first workspace
  useEffect(() => {
    if (selectedWorkspaceId !== null || !workspaces?.length) return;
    setSelectedWorkspaceId(workspaces[0]._id);
  }, [workspaces, selectedWorkspaceId]);

  // Open new session pane when workspace changes
  useEffect(() => {
    setSelectedSessionId(undefined);
  }, [selectedWorkspaceId]);

  // Refresh capabilities when workspace is selected
  useEffect(() => {
    if (selectedWorkspaceId) refreshCapabilities(selectedWorkspaceId);
  }, [selectedWorkspaceId, refreshCapabilities]);

  if (workspaces === undefined || machinesResult === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (machines.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <MonitorOff size={32} className="text-muted-foreground/50" />
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-sm font-bold">No machines connected</p>
          <p className="text-xs text-muted-foreground">
            Run <code className="bg-muted px-1 py-0.5 rounded text-xs">chatroom machine start</code>{' '}
            on your machine to get started.
          </p>
        </div>
      </div>
    );
  }

  const handleRegisterWorkspace = async () => {
    if (!registerMachineId || !registerWorkingDir.trim()) return;
    setRegisterSubmitting(true);
    setRegisterError(null);
    try {
      const selectedMachine = machines.find((m) => m.machineId === registerMachineId);
      await registerWorkspace({
        chatroomId,
        machineId: registerMachineId,
        workingDir: registerWorkingDir.trim(),
        hostname: selectedMachine?.hostname ?? 'unknown',
        registeredBy: 'user',
      });
      setShowRegisterDialog(false);
      setRegisterMachineId('');
      setRegisterWorkingDir('');
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Failed to register workspace.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const showMobileDetail = selectedWorkspaceId != null && selectedSessionId !== null;

  const sidebar = (
    <div className="w-full flex flex-col min-h-0 flex-1">
      {/* Workspace picker + new button */}
      <div className="shrink-0 p-2 border-b-2 border-border flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          {workspaces.length > 0 ? (
            <HarnessWorkspaceSwitcher
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelect={setSelectedWorkspaceId}
            />
          ) : (
            <span className="text-xs text-muted-foreground px-1">No workspaces</span>
          )}
        </div>
        {selectedWorkspaceId && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            title="New session"
            onClick={() => setSelectedSessionId(undefined)}
          >
            <SquarePen size={14} />
          </Button>
        )}
      </div>

      {/* Session list */}
      {selectedWorkspaceId ? (
        <SessionList
          workspaceId={selectedWorkspaceId}
          selectedSessionId={selectedSessionId ?? null}
          onSelect={setSelectedSessionId}
          optimisticallyClosedIds={optimisticallyClosedIds}
          closingIds={closingIds}
          onCloseSession={closeSession}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
          {workspaces.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">Register a workspace to start.</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setShowRegisterDialog(true)}
              >
                <Plus size={12} />
                Register workspace
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Select a workspace.</p>
          )}
        </div>
      )}
    </div>
  );

  const detailPane = (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {selectedSessionId ? (
        <SelectedSessionDetail
          selectedSessionId={selectedSessionId}
          workspaceId={selectedWorkspaceId}
          optimisticallyClosedIds={optimisticallyClosedIds}
        />
      ) : selectedSessionId === undefined && selectedWorkspaceId ? (
        <NewSessionComposer
          workspaceId={selectedWorkspaceId}
          onSessionCreated={(id) => setSelectedSessionId(id)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground select-none">
          {selectedWorkspaceId
            ? 'Select a session or start a new one.'
            : 'Select a workspace to begin.'}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="@container flex-1 flex min-h-0 overflow-hidden">
        <div
          className={cn(
            'shrink-0 flex flex-col min-h-0 overflow-hidden bg-card border-border',
            showMobileDetail ? 'hidden @md:flex' : 'flex flex-1 @md:flex-none',
            '@md:w-64 @md:border-r-2'
          )}
        >
          {sidebar}
        </div>

        <div
          className={cn(
            'flex-1 flex flex-col min-h-0 overflow-hidden',
            showMobileDetail ? 'flex' : 'hidden @md:flex'
          )}
        >
          {showMobileDetail ? (
            <div className="shrink-0 border-b-2 border-border px-2 py-1.5 flex items-center gap-1 bg-card @md:hidden">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                aria-label="Back to sessions"
                onClick={() => setSelectedSessionId(null)}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Sessions
              </span>
            </div>
          ) : null}
          {detailPane}
        </div>
      </div>

      {/* Register Workspace Dialog */}
      {showRegisterDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20">
          <div className="bg-card border border-border shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider">Register workspace</h3>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Machine
              </label>
              <Select value={registerMachineId} onValueChange={setRegisterMachineId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select machine…" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map((m) => (
                    <SelectItem key={m.machineId} value={m.machineId} className="text-xs">
                      {m.alias ?? m.hostname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Working directory
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="/path/to/project"
                value={registerWorkingDir}
                onChange={(e) => setRegisterWorkingDir(e.target.value)}
              />
            </div>

            {registerError && (
              <p className="text-xs text-red-600 dark:text-red-400">{registerError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setShowRegisterDialog(false);
                  setRegisterError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!registerMachineId || !registerWorkingDir.trim() || registerSubmitting}
                onClick={() => void handleRegisterWorkspace()}
              >
                {registerSubmitting ? 'Registering…' : 'Register'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
