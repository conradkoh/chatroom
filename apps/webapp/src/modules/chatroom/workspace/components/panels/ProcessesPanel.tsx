/**
 * ProcessesPanel — ActivityBar panel for command launching and process management.
 *
 * Replaces the old ProcessManager dialog. Rendered as a full workspace panel
 * when the 'processes' activity view is selected.
 *
 * Layout (desktop): two-pane split via ResizablePanelGroup
 *   Left: search + running processes + workspace browser + recent
 *   Right: OutputPanel / CommandDetailPanel / WorkspaceDetailPanel
 *
 * Layout (mobile): master-detail — one pane at a time, back button on detail.
 * Mirrors PullRequestsPanel's pattern.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { EmptyOutputState } from './EmptyOutputState';
import { CommandDetailPanel } from '../../../features/run-command/components/CommandDetailPanel';
import { OutputPanel } from '../../../features/run-command/components/OutputPanel';
import { ProcessList } from '../../../features/run-command/components/ProcessList';
import { WorkspaceDetailPanel } from '../../../features/run-command/components/WorkspaceDetailPanel';
import { useProcessesPanelState } from '../../../features/run-command/hooks/useProcessesPanelState';
import type {
  CommandRun,
  RunnableCommand,
  OutputChunk,
} from '../../../features/run-command/types/run';
import { getCompactDisplayName } from '../../../features/run-command/utils/grouping';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { isValidTwoPaneLayout } from '@/modules/chatroom/hooks/twoPaneLayout';
import { usePersistedState } from '@/modules/chatroom/hooks/usePersistedState';

// ─── Layout Persistence ───────────────────────────────────────────────────────

const PROCESSES_LAYOUT_KEY = 'webapp:processesPanelSizes';
const PROCESSES_DEFAULT_LAYOUT: readonly number[] = [30, 70] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProcessesPanelProps {
  machineId?: string | null;
  workingDir?: string | null;
  commands: RunnableCommand[];
  runs: CommandRun[];
  activeRunOutput: {
    chunks: OutputChunk[];
    run: CommandRun | null;
    canLoadMore?: boolean;
    loadMore?: () => void | Promise<void>;
    fullOutputPending?: boolean;
  };
  onRunCommand: (commandName: string, script: string) => void;
  onStopCommand: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onClearRun: () => void;
  /** Pre-selected command name — opens with this command's detail panel */
  initialSelectedCommand?: string | null;
  /** Called after the initial command has been consumed */
  onConsumedInitialCommand?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProcessesPanel({
  machineId,
  workingDir,
  commands,
  runs,
  activeRunOutput,
  onRunCommand,
  onStopCommand,
  onSelectRun,
  onClearRun,
  initialSelectedCommand,
  onConsumedInitialCommand,
}: ProcessesPanelProps) {
  const state = useProcessesPanelState({
    commands,
    runs,
    onClearRun,
    initialSelectedCommand,
    onConsumedInitialCommand,
  });

  const {
    searchQuery,
    setSearchQuery,
    selectedCommand,
    setSelectedCommand,
    selectedWorkspace,
    setSelectedWorkspace,
    setPreviousWorkspace,
    previousWorkspace,
    previousCommand,
    setPreviousCommand,
    focusedIndex,
    handleKeyDown,
    favorites,
    toggleFavorite,
    workspaceGroups,
    runningProcesses,
    recentRuns,
  } = state;

  // Layout persistence — mirrors PullRequestsPanel pattern
  const [sizes, setSizes] = usePersistedState<number[]>(
    PROCESSES_LAYOUT_KEY,
    [...PROCESSES_DEFAULT_LAYOUT],
    {
      validate: isValidTwoPaneLayout,
    }
  );
  const handleLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      const next = [
        layout['processes-sidebar'] ?? sizes[0],
        layout['processes-detail'] ?? sizes[1],
      ];
      if (isValidTwoPaneLayout(next)) setSizes(next);
    },
    [setSizes, sizes]
  );

  // Clear stuck dialog state
  const [clearStuckOpen, setClearStuckOpen] = useState(false);
  const clearStuckRuns = useSessionMutation(api.commands.clearStuckCommandRuns);

  const pendingOrRunningCount = runningProcesses.length;

  const handleClearStuck = useCallback(async () => {
    if (!machineId || !workingDir) return;
    try {
      const result = await clearStuckRuns({ machineId, workingDir });
      toast.success(`Cleared ${result.clearedCount} stuck command(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear stuck commands');
    } finally {
      setClearStuckOpen(false);
    }
  }, [machineId, workingDir, clearStuckRuns]);

  const handleRunCommand = useCallback(
    (cmd: RunnableCommand) => {
      onRunCommand(cmd.name, cmd.script);
    },
    [onRunCommand]
  );

  const handleRestartCommand = useCallback(
    (run: CommandRun) => {
      const cmd = commands.find((c) => c.name === run.commandName);
      if (cmd) {
        onRunCommand(cmd.name, cmd.script);
      }
    },
    [commands, onRunCommand]
  );

  // Determine if mobile should show detail pane
  const hasRightPanelContent = !!(selectedWorkspace || selectedCommand || activeRunOutput.run);

  // ─── Sidebar ──────────────────────────────────────────────────────────────

  const sidebar = (
    <div className="flex flex-col h-full overflow-hidden" onKeyDown={handleKeyDown}>
      {/* Search */}
      <div className="p-1.5 sm:p-2 border-b border-chatroom-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search commands..."
          className="w-full px-3 py-1.5 text-xs bg-chatroom-bg-primary text-chatroom-text-primary border border-chatroom-border rounded-none placeholder:text-chatroom-text-muted focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Running processes */}
        {runningProcesses.length > 0 && (
          <ProcessList
            title={`Running (${runningProcesses.length})`}
            runs={runningProcesses}
            onStop={onStopCommand}
            onSelect={(runId) => {
              setPreviousCommand(selectedCommand);
              setSelectedCommand(null);
              setSelectedWorkspace(null);
              onSelectRun(runId);
            }}
            onRestart={handleRestartCommand}
            selectedRunId={activeRunOutput.run?._id ?? null}
          />
        )}

        {/* Command browser */}
        {searchQuery ? (
          /* Search results: flat list of matching commands */
          <div>
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted/70 border-b border-chatroom-border/30">
              Search Results ({workspaceGroups.reduce((sum, ws) => sum + ws.allCommands.length, 0)})
            </div>
            {workspaceGroups.flatMap((ws, wsIdx) => {
              const offset = workspaceGroups
                .slice(0, wsIdx)
                .reduce((sum, g) => sum + g.allCommands.length, 0);
              return ws.allCommands.map((cmd, cmdIdx) => {
                const currentIdx = offset + cmdIdx;
                const isFav = favorites.has(cmd.name);
                const isFocused = currentIdx === focusedIndex;
                return (
                  <button
                    key={cmd.name}
                    onClick={() => {
                      onClearRun();
                      setSelectedWorkspace(ws);
                      setSelectedCommand(cmd);
                    }}
                    className={`w-full flex items-start gap-2 px-3 py-2 transition-colors border-b border-chatroom-border/20 text-left ${
                      isFocused ? 'bg-chatroom-bg-hover' : 'hover:bg-chatroom-bg-hover/50'
                    }`}
                  >
                    <span className="text-yellow-500 flex-shrink-0 mt-0.5">
                      {isFav ? '★' : '☆'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-xs font-bold uppercase tracking-wider truncate ${
                          isFocused ? 'text-blue-400' : 'text-chatroom-text-primary'
                        }`}
                      >
                        {getCompactDisplayName(cmd.name, cmd.script)}
                      </div>
                      <div className="text-[10px] text-chatroom-text-muted/70 truncate">
                        {ws.path === '.' ? 'Root' : ws.path}
                      </div>
                    </div>
                  </button>
                );
              });
            })}
          </div>
        ) : (
          /* Workspace list */
          <div>
            {workspaceGroups.map((ws, idx) => {
              const isFocused = idx === focusedIndex;
              return (
                <button
                  key={ws.path}
                  onClick={() => {
                    onClearRun();
                    setSelectedWorkspace(ws);
                    setSelectedCommand(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors border-b border-chatroom-border/20 ${
                    isFocused
                      ? 'bg-chatroom-bg-hover text-chatroom-text-primary'
                      : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
                  }`}
                >
                  <span className="truncate">{ws.path === '.' ? 'Root' : ws.path}</span>
                  <span className="ml-auto text-chatroom-text-muted/50 text-[10px]">
                    {ws.allCommands.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Recent runs */}
        {recentRuns.length > 0 && (
          <ProcessList
            title="Recent"
            runs={recentRuns}
            onStop={onStopCommand}
            onSelect={(runId) => {
              setPreviousCommand(selectedCommand);
              setSelectedCommand(null);
              setSelectedWorkspace(null);
              onSelectRun(runId);
            }}
            onRestart={handleRestartCommand}
            selectedRunId={activeRunOutput.run?._id ?? null}
          />
        )}
      </div>
    </div>
  );

  // ─── Detail pane ─────────────────────────────────────────────────────────

  const detail = activeRunOutput.run ? (
    <OutputPanel
      key={activeRunOutput.run._id}
      run={activeRunOutput.run}
      chunks={activeRunOutput.chunks}
      canLoadMore={
        activeRunOutput.canLoadMore ||
        activeRunOutput.run.status === 'running' ||
        activeRunOutput.run.status === 'pending'
      }
      onLoadMore={activeRunOutput.loadMore}
      fullOutputPending={activeRunOutput.fullOutputPending}
      onStop={() => {
        if (activeRunOutput.run) onStopCommand(activeRunOutput.run._id);
      }}
      onRestart={() => {
        if (activeRunOutput.run) handleRestartCommand(activeRunOutput.run);
      }}
      onClose={() => {
        onClearRun();
        if (previousCommand) {
          setSelectedCommand(previousCommand);
          setPreviousCommand(null);
        }
      }}
    />
  ) : selectedWorkspace ? (
    <WorkspaceDetailPanel
      workspace={selectedWorkspace}
      favorites={favorites}
      onRun={handleRunCommand}
      onToggleFavorite={toggleFavorite}
      onSelectCommand={(cmd) => {
        setPreviousWorkspace(selectedWorkspace);
        setSelectedCommand(cmd);
        setSelectedWorkspace(null);
      }}
      onClose={() => setSelectedWorkspace(null)}
    />
  ) : selectedCommand ? (
    <CommandDetailPanel
      command={selectedCommand}
      isFavorite={favorites.has(selectedCommand.name)}
      runs={runs}
      onRun={() => handleRunCommand(selectedCommand)}
      onStop={onStopCommand}
      onSelectRun={(runId) => {
        setPreviousCommand(selectedCommand);
        setSelectedCommand(null);
        onSelectRun(runId);
      }}
      onToggleFavorite={() => toggleFavorite(selectedCommand.name)}
      onBack={() => {
        if (previousWorkspace) {
          setSelectedWorkspace(previousWorkspace);
          setSelectedCommand(null);
          setPreviousWorkspace(null);
        } else {
          setSelectedCommand(null);
        }
      }}
    />
  ) : (
    <EmptyOutputState />
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-1.5 py-1.5 sm:px-4 sm:py-2 border-b-2 border-chatroom-border shrink-0">
          <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            Processes
          </h2>
          {machineId && workingDir && (
            <button
              type="button"
              disabled={pendingOrRunningCount === 0}
              onClick={() => setClearStuckOpen(true)}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Clear stuck
            </button>
          )}
        </div>

        {/* Body — layout is driven by the panel's own width via container queries,
            not the viewport. Below @md (28rem ≈ 448px) we collapse to a single
            master-detail pane so a narrow docked sidebar gets the full width. */}
        <div className="@container flex-1 overflow-hidden flex flex-col">
          {/* Split layout (container ≥ @md) */}
          <div className="hidden @md:flex flex-1 overflow-hidden">
            <ResizablePanelGroup className="flex-1" onLayoutChanged={handleLayoutChanged}>
              <ResizablePanel id="processes-sidebar" defaultSize={sizes[0]} minSize={18}>
                {sidebar}
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="processes-detail" defaultSize={sizes[1]} minSize={30}>
                {detail}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          {/* Single-pane layout (container < @md) — back buttons on detail
              panels handle navigation back to the list. */}
          <div className="flex @md:hidden flex-1 overflow-hidden">
            {hasRightPanelContent ? detail : sidebar}
          </div>
        </div>
      </div>

      {/* Clear stuck confirm dialog */}
      <AlertDialog open={clearStuckOpen} onOpenChange={setClearStuckOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear stuck commands?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks all pending and running commands for this workspace as stopped. Use this
              only when the daemon is unresponsive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearStuck}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear stuck
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
