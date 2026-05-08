'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { MonitorOff, Plus, SquarePen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

import { NewSessionComposer } from './SessionComposer';
import { SessionDetail } from './SessionDetail';
import { SessionList } from './SessionList';
import { HarnessWorkspaceSwitcher } from './HarnessWorkspaceSwitcher';
import { useRefreshCapabilities } from '../hooks/useRefreshCapabilities';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

// ─── SelectedSessionDetail ────────────────────────────────────────────────────

function SelectedSessionDetail({
  selectedSessionId,
  workspaceId,
}: {
  selectedSessionId: Id<'chatroom_harnessSessions'>;
  workspaceId: Id<'chatroom_workspaces'> | null;
}) {
  const sessions = useSessionQuery(api.web.directHarness.sessions.listSessions, workspaceId ? { workspaceId } : 'skip');
  const sessionSummary = sessions?.find((s) => s._id === selectedSessionId);

  if (!sessionSummary) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <SessionDetail sessionRowId={selectedSessionId} sessionSummary={sessionSummary} />;
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
          <p className="text-sm font-medium">No machines connected</p>
          <p className="text-xs text-muted-foreground">
            Run{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">chatroom machine start</code>{' '}
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

  return (
    <>
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col min-h-0 bg-card">
          {/* Workspace picker + new button */}
          <div className="shrink-0 p-2 border-b border-border flex items-center gap-1.5">
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

        {/* ── Right pane ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {selectedSessionId ? (
            /* Existing session */
            <SelectedSessionDetail
              selectedSessionId={selectedSessionId}
              workspaceId={selectedWorkspaceId}
            />
          ) : selectedSessionId === undefined && selectedWorkspaceId ? (
            /* New session pane */
            <NewSessionComposer
              workspaceId={selectedWorkspaceId}
              onSessionCreated={(id) => setSelectedSessionId(id)}
            />
          ) : (
            /* Nothing selected */
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground select-none">
              {selectedWorkspaceId
                ? 'Select a session or start a new one.'
                : 'Select a workspace to begin.'}
            </div>
          )}
        </div>
      </div>

      {/* Register Workspace Dialog */}
      {showRegisterDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold">Register workspace</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Machine</label>
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
              <label className="text-xs font-medium text-muted-foreground">Working directory</label>
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
                onClick={() => { setShowRegisterDialog(false); setRegisterError(null); }}
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
