/**
 * ProcessManager — Split-pane panel for command launching and process management.
 *
 * Layout:
 * - Left sidebar: Command browser (collapsible sections) + Running processes
 * - Right panel: Terminal output for selected process
 *
 * Accessible via Cmd+Shift+P → "Open Process Manager"
 */

'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { toast } from 'sonner';

import { api } from '@workspace/backend/convex/_generated/api';
import { cn } from '@/lib/utils';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
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
import { ProcessList } from './ProcessList';
import { OutputPanel } from './OutputPanel';
import { CommandDetailPanel } from './panels/CommandDetailPanel';
import { WorkspaceDetailPanel } from './panels/WorkspaceDetailPanel';
import { getCommandFavoritesStore } from '../../lib/commandFavoritesStore';
import { useEscapeToClear } from '../../hooks/useEscapeToClear';
import {
  groupCommandsByWorkspace,
  getCompactDisplayName,
  type WorkspaceGroup,
} from './helpers';
import { isActiveRun } from '../../features/run-command/utils/run-status';

// ─── Types (re-exported from feature slice for back-compat) ─────────────────

export type { CommandRun, RunnableCommand, OutputChunk } from '../../features/run-command/types/run';
import type { CommandRun, RunnableCommand, OutputChunk } from '../../features/run-command/types/run';

export interface ProcessManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: RunnableCommand[];
  runs: CommandRun[];
  activeRunOutput: { chunks: OutputChunk[]; run: CommandRun | null };
  onRunCommand: (commandName: string, script: string) => void;
  onStopCommand: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onClearRun: () => void;
  /** Pre-selected command name — opens with this command's details panel */
  initialSelectedCommand?: string | null;
  /** Machine ID + workingDir for clear-stuck-runs mutation */
  machineId?: string | null;
  workingDir?: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProcessManager({
  open,
  onOpenChange,
  commands,
  runs,
  activeRunOutput,
  onRunCommand,
  onStopCommand,
  onSelectRun,
  onClearRun,
  initialSelectedCommand,
  machineId,
  workingDir,
}: ProcessManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const onEscapeKeyDown = useEscapeToClear(searchQueryRef, () => setSearchQuery(''));
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesStore = useMemo(() => getCommandFavoritesStore(), []);

  // Clear stuck runs — confirm dialog + mutation
  const [clearStuckOpen, setClearStuckOpen] = useState(false);
  const clearStuckRuns = useSessionMutation(api.commands.clearStuckCommandRuns);

  const pendingOrRunningCount = runs.filter((r) => isActiveRun(r.status)).length;

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

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedCommand(null);
      setSelectedWorkspace(null);
      setPreviousWorkspace(null);
      setPreviousCommand(null);
    }
  }, [open]);

  // Pre-select a command when opening with initialSelectedCommand
  useEffect(() => {
    if (open && initialSelectedCommand && commands.length > 0) {
      const cmd = commands.find((c) => c.name === initialSelectedCommand);
      if (cmd) {
        setSelectedCommand(cmd);
        // Clear workspace selection so CommandDetailPanel takes priority
        setSelectedWorkspace(null);
        // Track the workspace for back navigation
        const groups = groupCommandsByWorkspace(commands, '');
        const ws = groups.find((g) =>
          g.allCommands.some((c: RunnableCommand) => c.name === cmd.name)
        );
        if (ws) setPreviousWorkspace(ws);
      }
    }
  }, [open, initialSelectedCommand, commands]);

  // Get current favorites (recomputed when version changes)
  const favorites = useMemo(
    () => favoritesStore.getAll(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favoritesStore, favoritesVersion]
  );

  const handleToggleFavorite = useCallback(
    (commandName: string) => {
      favoritesStore.toggle(commandName);
      setFavoritesVersion((v) => v + 1);
    },
    [favoritesStore]
  );

  const [selectedCommand, setSelectedCommand] = useState<RunnableCommand | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceGroup | null>(null);
  const [previousWorkspace, setPreviousWorkspace] = useState<WorkspaceGroup | null>(null);
  const [previousCommand, setPreviousCommand] = useState<RunnableCommand | null>(null);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Group commands by workspace
  const workspaceGroups = groupCommandsByWorkspace(commands, searchQuery);

  // Flat list of selectable items for keyboard navigation
  const selectableItems = useMemo(() => {
    if (searchQuery) {
      // Search mode: flat list of commands
      return workspaceGroups.flatMap((ws) =>
        ws.allCommands.map((cmd) => ({ type: 'command' as const, ws, cmd }))
      );
    }
    // Browse mode: list of workspaces
    return workspaceGroups.map((ws) => ({ type: 'workspace' as const, ws }));
  }, [workspaceGroups, searchQuery]);

  // Reset focused index when search changes or dialog opens
  useEffect(() => {
    setFocusedIndex(0);
  }, [searchQuery, open]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = selectableItems;
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (!item) return;

        if (item.type === 'workspace') {
          onClearRun();
          setSelectedWorkspace(item.ws);
          setSelectedCommand(null);
        } else {
          onClearRun();
          setSelectedWorkspace(item.ws);
          setSelectedCommand(item.cmd);
        }
      }
    },
    [selectableItems, focusedIndex, onClearRun]
  );

  // Separate running and recent runs
  const runningProcesses = runs.filter((r) => isActiveRun(r.status));
  const recentRuns = runs
    .filter((r) => !isActiveRun(r.status))
    .slice(0, 10);

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

  // Determine if mobile should switch to detail view
  const hasRightPanelContent = !!(selectedWorkspace || selectedCommand || activeRunOutput.run);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <DialogPrimitive.Content
          onEscapeKeyDown={onEscapeKeyDown}
          className="fixed left-[50%] top-[50%] z-50 w-[1000px] max-w-[95vw] h-[600px] max-h-[85vh] translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-1.5 py-1.5 sm:px-4 sm:py-2 border-b-2 border-chatroom-border">
            <DialogPrimitive.Title className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              Process Manager
            </DialogPrimitive.Title>
            <div className="flex items-center gap-2">
              {/* Clear stuck runs button — only when machineId + workingDir available */}
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
              <DialogPrimitive.Close className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1">
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </div>

          <DialogPrimitive.Description className="sr-only">
            Browse and run commands, manage running processes
          </DialogPrimitive.Description>

          {/* Split pane */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar */}
            <div
              className={cn(
                'w-[320px] min-w-[280px] border-r-2 border-chatroom-border flex flex-col overflow-hidden',
                hasRightPanelContent && 'hidden md:flex'
              )}
              onKeyDown={handleKeyDown}
            >
              {/* Search */}
              <div className="p-1.5 sm:p-2 border-b border-chatroom-border">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search commands..."
                  className="w-full px-3 py-1.5 text-xs bg-chatroom-bg-primary text-chatroom-text-primary border border-chatroom-border rounded-none placeholder:text-chatroom-text-muted focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">
                {/* Running Processes */}
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

                {/* Command Browser — workspaces only (no inline buttons) */}
                {searchQuery ? (
                  /* Search results: flat list of matching commands */
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted/70 border-b border-chatroom-border/30">
                      Search Results (
                      {workspaceGroups.reduce((sum, ws) => sum + ws.allCommands.length, 0)})
                    </div>
                    {(() => {
                      let idx = 0;
                      return workspaceGroups.flatMap((ws) =>
                        ws.allCommands.map((cmd) => {
                          const currentIdx = idx++;
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
                        })
                      );
                    })()}
                  </div>
                ) : (
                  /* Workspace list: only names, no inline buttons */
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

                {/* Recent Runs */}
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

            {/* Right panel — Terminal output, command detail, or workspace detail */}
            <div
              className={cn(
                'flex-1 flex flex-col overflow-hidden',
                !hasRightPanelContent && 'hidden md:flex'
              )}
            >
              {activeRunOutput.run ? (
                <OutputPanel
                  key={activeRunOutput.run._id}
                  run={activeRunOutput.run}
                  chunks={activeRunOutput.chunks}
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
                  onToggleFavorite={handleToggleFavorite}
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
                  onToggleFavorite={() => handleToggleFavorite(selectedCommand.name)}
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
                <OutputPanel run={null} chunks={[]} onStop={() => {}} onRestart={() => {}} />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>

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
    </Dialog>
  );
}

// ─── Helpers re-exported for consumers ──────────────────────────────────────

export type { WorkspaceGroup } from './helpers';
