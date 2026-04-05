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

import { useState, useCallback, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { ProcessList } from './ProcessList';
import { OutputPanel } from './OutputPanel';
import { getCommandFavoritesStore } from '../../lib/commandFavoritesStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunnableCommand {
  name: string;
  script: string;
  source: string;
  workspace?: string;
}

export interface CommandRun {
  _id: string;
  commandName: string;
  script: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  pid?: number;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
}

export interface OutputChunk {
  content: string;
  chunkIndex: number;
}

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
}: ProcessManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesStore = useMemo(() => getCommandFavoritesStore(), []);

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedCommand(null);
      setSelectedWorkspace(null);
      setPreviousWorkspace(null);
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
        const ws = groups.find((g) => g.allCommands.some((c: RunnableCommand) => c.name === cmd.name));
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

  // Group commands by workspace
  const workspaceGroups = groupCommandsByWorkspace(commands, searchQuery);

  // Separate running and recent runs
  const runningProcesses = runs.filter(
    (r) => r.status === 'running' || r.status === 'pending'
  );
  const recentRuns = runs.filter(
    (r) => r.status !== 'running' && r.status !== 'pending'
  ).slice(0, 10);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-[1000px] max-w-[95vw] h-[600px] max-h-[85vh] translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-200"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b-2 border-chatroom-border">
            <DialogPrimitive.Title className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              Process Manager
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <DialogPrimitive.Description className="sr-only">
            Browse and run commands, manage running processes
          </DialogPrimitive.Description>

          {/* Split pane */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar */}
            <div className="w-[320px] min-w-[280px] border-r-2 border-chatroom-border flex flex-col overflow-hidden">
              {/* Search */}
              <div className="p-2 border-b border-chatroom-border">
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
                    onSelect={(runId) => { setSelectedCommand(null); onSelectRun(runId); }}
                    onRestart={handleRestartCommand}
                    selectedRunId={activeRunOutput.run?._id ?? null}
                  />
                )}

                {/* Command Browser */}
                {/* Workspace sections with quick commands */}
                {workspaceGroups.map((ws) => (
                  <div key={ws.path} className="border-b border-chatroom-border/50">
                    <button
                      onClick={() => {
                        onClearRun();
                        setSelectedWorkspace(ws);
                        setSelectedCommand(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:bg-chatroom-bg-hover transition-colors"
                    >
                      <span className="truncate">{ws.path === '.' ? 'Root' : ws.path}</span>
                      <span className="ml-auto text-chatroom-text-muted/50 text-[10px]">{ws.allCommands.length}</span>
                    </button>
                    {/* Quick commands + favorites as inline buttons */}
                    <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                      {getVisibleCommands(ws, favorites).map((cmd) => {
                        const isFav = favorites.has(cmd.name);
                        return (
                          <button
                            key={cmd.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              onClearRun();
                              setSelectedCommand(cmd);
                              setSelectedWorkspace(null);
                            }}
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                              isFav
                                ? 'text-yellow-500 bg-yellow-500/10 hover:bg-blue-600 hover:text-white'
                                : 'text-chatroom-text-primary bg-chatroom-bg-hover/50 hover:bg-blue-600 hover:text-white'
                            }`}
                            title={cmd.script}
                          >
                            {isFav ? '★ ' : ''}{getCompactDisplayName(cmd.name, cmd.script)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Recent Runs */}
                {recentRuns.length > 0 && (
                  <ProcessList
                    title="Recent"
                    runs={recentRuns}
                    onStop={onStopCommand}
                    onSelect={(runId) => { setSelectedCommand(null); onSelectRun(runId); }}
                    onRestart={handleRestartCommand}
                    selectedRunId={activeRunOutput.run?._id ?? null}
                  />
                )}
              </div>
            </div>

            {/* Right panel — Terminal output, command detail, or workspace detail */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {activeRunOutput.run ? (
                <OutputPanel
                  run={activeRunOutput.run}
                  chunks={activeRunOutput.chunks}
                  onStop={() => {
                    if (activeRunOutput.run) onStopCommand(activeRunOutput.run._id);
                  }}
                  onRestart={() => {
                    if (activeRunOutput.run) handleRestartCommand(activeRunOutput.run);
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
                />
              ) : selectedCommand ? (
                <CommandDetailPanel
                  command={selectedCommand}
                  isFavorite={favorites.has(selectedCommand.name)}
                  runs={runs}
                  onRun={() => handleRunCommand(selectedCommand)}
                  onStop={onStopCommand}
                  onSelectRun={(runId) => { setSelectedCommand(null); onSelectRun(runId); }}
                  onToggleFavorite={() => handleToggleFavorite(selectedCommand.name)}
                  onBack={previousWorkspace ? () => {
                    setSelectedWorkspace(previousWorkspace);
                    setSelectedCommand(null);
                    setPreviousWorkspace(null);
                  } : undefined}
                />
              ) : (
                <OutputPanel run={null} chunks={[]} onStop={() => {}} onRestart={() => {}} />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The 4 default quick commands shown in the sidebar. */
const QUICK_COMMAND_NAMES = new Set(['dev', 'start', 'test', 'build']);

/** Check if a command name contains a quick command (e.g., 'pnpm: dev' → 'dev'). */
function extractScriptName(commandName: string): string {
  // Handle patterns like "pnpm: dev", "turbo: build", "@workspace/webapp: dev"
  const colonIdx = commandName.indexOf(':');
  let scriptPart = colonIdx > 0 ? commandName.slice(colonIdx + 1).trim() : commandName;
  // Handle "turbo: build (chatroom-cli)" → "build"
  const parenIdx = scriptPart.indexOf('(');
  if (parenIdx > 0) scriptPart = scriptPart.slice(0, parenIdx).trim();
  return scriptPart;
}

/** Get a compact display name including the tool prefix (e.g., 'pnpm:dev', 'turbo:build'). */
function getCompactDisplayName(commandName: string, script: string): string {
  const scriptName = extractScriptName(commandName);
  const colonIdx = commandName.indexOf(':');
  if (colonIdx <= 0) return commandName;
  const tool = commandName.slice(0, colonIdx).trim();

  // If the tool is a known PM or 'turbo', use it directly
  const knownTools = ['pnpm', 'npm', 'yarn', 'bun', 'turbo'];
  if (knownTools.includes(tool)) {
    return `${tool}:${scriptName}`;
  }

  // For package-scoped commands (e.g., '@workspace/webapp: build'),
  // infer the PM from the script prefix
  const pmMatch = script.match(/^(pnpm|npm|npx|yarn|bun)\b/);
  const pm = pmMatch ? (pmMatch[1] === 'npx' ? 'turbo' : pmMatch[1]) : 'run';
  return `${pm}:${scriptName}`;
}

interface WorkspaceGroup {
  /** Relative path (e.g., '.', 'apps/webapp') */
  path: string;
  /** Quick commands (dev/start/test/build) for sidebar display */
  quickCommands: RunnableCommand[];
  /** All commands for this workspace */
  allCommands: RunnableCommand[];
}

function groupCommandsByWorkspace(
  commands: RunnableCommand[],
  searchQuery: string
): WorkspaceGroup[] {
  // Filter by search query
  const filtered = searchQuery
    ? commands.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.script.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commands;

  // Group by workspace path
  const groups = new Map<string, RunnableCommand[]>();

  for (const cmd of filtered) {
    const ws = cmd.workspace ?? '.';
    const existing = groups.get(ws) ?? [];
    existing.push(cmd);
    groups.set(ws, existing);
  }

  // Build workspace groups with quick commands
  const result: WorkspaceGroup[] = [];
  for (const [path, cmds] of groups) {
    const quickCommands = cmds.filter((c) => QUICK_COMMAND_NAMES.has(extractScriptName(c.name)));
    result.push({ path, quickCommands, allCommands: cmds });
  }

  // Sort: '.' (root) first, then alphabetical
  result.sort((a, b) => {
    if (a.path === '.') return -1;
    if (b.path === '.') return 1;
    return a.path.localeCompare(b.path);
  });

  return result;
}

// ─── Command Detail Panel ───────────────────────────────────────────────────

function CommandDetailPanel({
  command,
  isFavorite,
  runs,
  onRun,
  onStop,
  onSelectRun,
  onToggleFavorite,
  onBack,
}: {
  command: RunnableCommand;
  isFavorite: boolean;
  runs: CommandRun[];
  onRun: () => void;
  onStop: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onToggleFavorite: () => void;
  onBack?: () => void;
}) {
  const runningInstances = runs.filter(
    (r) => r.commandName === command.name && (r.status === 'running' || r.status === 'pending')
  );
  const recentInstances = runs.filter(
    (r) => r.commandName === command.name && r.status !== 'running' && r.status !== 'pending'
  ).slice(0, 5);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-chatroom-border">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary text-xs font-bold uppercase tracking-wider transition-colors"
            >
              ← Back
            </button>
          )}
          <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            {command.name}
          </h3>
        </div>
        <p className="text-xs text-chatroom-text-muted mt-1">
          Source: {command.source}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Script */}
        <div className="bg-black/60 rounded p-3">
          <code className="text-xs font-mono text-green-400 break-all">
            $ {command.script}
          </code>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onRun}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            ▶ {runningInstances.length > 0 ? 'Start New Instance' : 'Run'}
          </button>
          <button
            onClick={onToggleFavorite}
            className={`flex items-center gap-1 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              isFavorite
                ? 'text-yellow-500 hover:bg-yellow-500/10'
                : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
            }`}
          >
            {isFavorite ? '★ Favorited' : '☆ Favorite'}
          </button>
        </div>

        {/* Running Instances */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
            Running Instances ({runningInstances.length})
          </h4>
          {runningInstances.length === 0 ? (
            <p className="text-xs text-chatroom-text-muted/50 italic">No running instances</p>
          ) : (
            <div className="space-y-1">
              {runningInstances.map((run) => (
                <div
                  key={run._id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-chatroom-bg-hover/30 hover:bg-chatroom-bg-hover transition-colors group"
                >
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 animate-pulse" />
                  <button
                    onClick={() => onSelectRun(run._id)}
                    className="flex-1 text-left text-xs text-chatroom-text-primary truncate hover:underline"
                  >
                    PID {run.pid ?? '...'} — {run.status}
                  </button>
                  <button
                    onClick={() => onStop(run._id)}
                    className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 text-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Runs */}
        {recentInstances.length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
              Recent Runs
            </h4>
            <div className="space-y-1">
              {recentInstances.map((run) => (
                <div
                  key={run._id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-chatroom-bg-hover/30 transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    run.status === 'completed' ? 'bg-chatroom-text-muted/50' :
                    run.status === 'failed' ? 'bg-red-500' :
                    'bg-yellow-500'
                  }`} />
                  <button
                    onClick={() => onSelectRun(run._id)}
                    className="flex-1 text-left text-xs text-chatroom-text-muted truncate hover:underline"
                  >
                    {run.status}{run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ''}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Workspace Detail Panel ─────────────────────────────────────────────────

function WorkspaceDetailPanel({
  workspace,
  favorites,
  onRun,
  onToggleFavorite,
  onSelectCommand,
}: {
  workspace: WorkspaceGroup;
  favorites: Set<string>;
  onRun: (cmd: RunnableCommand) => void;
  onToggleFavorite: (name: string) => void;
  onSelectCommand: (cmd: RunnableCommand) => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-chatroom-border">
        <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
          {workspace.path === '.' ? 'Root' : workspace.path}
        </h3>
        <p className="text-[10px] text-chatroom-text-muted mt-0.5">
          {workspace.allCommands.length} commands available
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {workspace.allCommands.map((cmd) => {
          const scriptName = extractScriptName(cmd.name);
          const isFav = favorites.has(cmd.name);
          return (
            <div
              key={cmd.name}
              className="flex items-center gap-2 px-4 py-1.5 hover:bg-chatroom-bg-hover transition-colors group"
            >
              <button
                onClick={() => onToggleFavorite(cmd.name)}
                className={`flex-shrink-0 transition-colors ${
                  isFav ? 'text-yellow-500' : 'text-chatroom-text-muted/30 hover:text-yellow-500/50'
                }`}
              >
                ★
              </button>
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onSelectCommand(cmd)}
              >
                <div className="text-xs text-chatroom-text-primary font-bold uppercase tracking-wider hover:underline">
                  {scriptName}
                </div>
                <div className="text-[10px] text-chatroom-text-muted truncate font-mono">
                  {cmd.script}
                </div>
              </div>
              <button
                onClick={() => onRun(cmd)}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
              >
                Run
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Visible Commands Helper ────────────────────────────────────────────────

/** Get commands visible in the sidebar: quick commands + favorites for this workspace. */
function getVisibleCommands(ws: WorkspaceGroup, favorites: Set<string>): RunnableCommand[] {
  const quickSet = new Set(ws.quickCommands.map((c) => c.name));
  const visible: RunnableCommand[] = [...ws.quickCommands];

  // Add favorites that aren't already in quick commands
  for (const cmd of ws.allCommands) {
    if (favorites.has(cmd.name) && !quickSet.has(cmd.name)) {
      visible.push(cmd);
    }
  }

  return visible;
}
