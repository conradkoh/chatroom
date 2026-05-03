'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { MonitorOff, Plus } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { NewSessionForm } from './NewSessionForm';
import { SessionDetail } from './SessionDetail';
import { SessionList } from './SessionList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

export const DirectHarnessView = memo(function DirectHarnessView({
  chatroomId,
}: DirectHarnessViewProps) {
  const workspaces = useSessionQuery(api.workspaces.listWorkspacesForChatroom, { chatroomId });
  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const registerWorkspace = useSessionMutation(api.workspaces.registerWorkspace);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<'chatroom_workspaces'> | null>(
    null
  );
  const [selectedSessionId, setSelectedSessionId] = useState<Id<'chatroom_harnessSessions'> | null>(
    null
  );

  // Register workspace dialog state
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [registerMachineId, setRegisterMachineId] = useState('');
  const [registerWorkingDir, setRegisterWorkingDir] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

  const machines = machinesResult?.machines ?? [];

  // Auto-select first workspace once they load (and only if nothing selected yet)
  useEffect(() => {
    if (selectedWorkspaceId !== null) return;
    if (!workspaces || workspaces.length === 0) return;
    setSelectedWorkspaceId(workspaces[0]._id);
  }, [workspaces, selectedWorkspaceId]);

  // Reset session selection whenever workspace changes
  useEffect(() => {
    setSelectedSessionId(null);
  }, [selectedWorkspaceId]);

  // Loading state — query returns undefined while in flight
  if (workspaces === undefined || machinesResult === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading workspaces…
      </div>
    );
  }

  // No machines at all — user needs to set up a daemon first
  if (machines.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <MonitorOff size={32} className="text-muted-foreground/50" />
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-sm font-medium text-foreground">No machines connected</p>
          <p className="text-xs text-muted-foreground">
            Install the Chatroom CLI on your machine and run{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              chatroom machine start
            </code>{' '}
            to register a machine and enable direct harness sessions.
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
      // The workspaces query will reactively update
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Failed to register workspace.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left pane — switcher + session list */}
      <div className="w-72 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
        <div className="shrink-0 border-b border-border p-2">
          {workspaces.length > 0 ? (
            <WorkspaceSwitcher
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelect={setSelectedWorkspaceId}
            />
          ) : (
            <div className="text-xs text-muted-foreground px-2 py-1.5">
              No workspaces in this chatroom
            </div>
          )}
        </div>
        {selectedWorkspaceId ? (
          <>
            <SessionList
              workspaceId={selectedWorkspaceId}
              selectedSessionId={selectedSessionId}
              onSelect={setSelectedSessionId}
            />
            <div className="shrink-0 border-t border-border p-2">
              <NewSessionForm
                workspaceId={selectedWorkspaceId}
                onSessionCreated={setSelectedSessionId}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs text-muted-foreground p-4 text-center">
            {workspaces.length === 0 ? (
              <>
                <p>Register a workspace to get started.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setShowRegisterDialog(true)}
                >
                  <Plus size={12} />
                  Register workspace
                </Button>
              </>
            ) : (
              <p>Select a workspace to begin.</p>
            )}
          </div>
        )}
      </div>

      {/* Right pane — session detail */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedSessionId ? (
          <SessionDetail sessionRowId={selectedSessionId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {selectedWorkspaceId ? 'Select a session.' : 'No workspace selected.'}
          </div>
        )}
      </div>
    </div>

      {/* Register Workspace Dialog */}
      {showRegisterDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-sm p-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Register workspace</h3>

            {/* Machine selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Machine</label>
              <Select
                value={registerMachineId}
                onValueChange={(v) => {
                  setRegisterMachineId(v);
                  setRegisterError(null);
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue placeholder="Select machine…" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  {machines.map((m) => (
                    <SelectItem key={m.machineId} value={m.machineId} className="text-xs">
                      {m.alias ?? m.hostname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Working directory */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Working directory
              </label>
              <Input
                className="h-8 text-xs bg-background border-border"
                placeholder="/path/to/your/project"
                value={registerWorkingDir}
                onChange={(e) => {
                  setRegisterWorkingDir(e.target.value);
                  setRegisterError(null);
                }}
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
