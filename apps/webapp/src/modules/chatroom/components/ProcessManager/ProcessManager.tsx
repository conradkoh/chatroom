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
import { CommandBrowser } from './CommandBrowser';
import { ProcessList } from './ProcessList';
import { OutputPanel } from './OutputPanel';
import { getCommandFavoritesStore } from '../../lib/commandFavoritesStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunnableCommand {
  name: string;
  script: string;
  source: string;
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
}: ProcessManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const favoritesStore = useMemo(() => getCommandFavoritesStore(), []);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearchQuery('');
  }, [open]);

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

  // Selected command for detail view (when not running)
  const [selectedCommand, setSelectedCommand] = useState<RunnableCommand | null>(null);

  // Group commands by category (extract prefix before ':')
  const groupedCommands = groupCommandsByCategory(commands, searchQuery);

  // Separate running and recent runs
  const runningProcesses = runs.filter(
    (r) => r.status === 'running' || r.status === 'pending'
  );
  const recentRuns = runs.filter(
    (r) => r.status !== 'running' && r.status !== 'pending'
  ).slice(0, 10);

  // Favorite commands
  const favoriteCommands = useMemo(
    () => commands.filter((c) => favorites.has(c.name)),
    [commands, favorites]
  );

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
                {/* Favorites (always at top) */}
                {favoriteCommands.length > 0 && !searchQuery && (
                  <div className="border-b border-chatroom-border">
                    <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-yellow-500">
                      ⭐ Favorites
                    </div>
                    {favoriteCommands.map((cmd) => (
                      <button
                        key={`fav-${cmd.name}`}
                        onClick={() => setSelectedCommand(cmd)}
                        className="w-full flex items-center gap-2 px-4 py-1 text-xs text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
                      >
                        <span className="truncate">{cmd.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Running Processes */}
                {runningProcesses.length > 0 && (
                  <ProcessList
                    title={`Running (${runningProcesses.length})`}
                    runs={runningProcesses}
                    onStop={onStopCommand}
                    onSelect={onSelectRun}
                    onRestart={handleRestartCommand}
                    selectedRunId={activeRunOutput.run?._id ?? null}
                  />
                )}

                {/* Command Browser */}
                <CommandBrowser
                  groups={groupedCommands}
                  onRun={handleRunCommand}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                  onSelect={(cmd) => setSelectedCommand(cmd)}
                />

                {/* Recent Runs */}
                {recentRuns.length > 0 && (
                  <ProcessList
                    title="Recent"
                    runs={recentRuns}
                    onStop={onStopCommand}
                    onSelect={onSelectRun}
                    onRestart={handleRestartCommand}
                    selectedRunId={activeRunOutput.run?._id ?? null}
                  />
                )}
              </div>
            </div>

            {/* Right panel — Terminal output or command detail */}
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
              ) : selectedCommand ? (
                <CommandDetailPanel
                  command={selectedCommand}
                  isFavorite={favorites.has(selectedCommand.name)}
                  onRun={() => handleRunCommand(selectedCommand)}
                  onToggleFavorite={() => handleToggleFavorite(selectedCommand.name)}
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

interface CommandGroup {
  label: string;
  commands: RunnableCommand[];
}

function groupCommandsByCategory(
  commands: RunnableCommand[],
  searchQuery: string
): CommandGroup[] {
  // Filter by search query
  const filtered = searchQuery
    ? commands.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.script.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commands;

  // Group by workspace:
  // - "pnpm: test" → Root
  // - "turbo: build" → Root  
  // - "turbo: build (chatroom-cli)" → chatroom-cli
  // - "chatroom-cli: build" → chatroom-cli
  const groups = new Map<string, RunnableCommand[]>();

  for (const cmd of filtered) {
    let workspace = 'Root';

    // Check for filtered turbo command: "turbo: task (package-name)"
    const parenMatch = cmd.name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      workspace = parenMatch[1];
    } else {
      // Check for package script: "package-name: script"
      const colonIdx = cmd.name.indexOf(':');
      if (colonIdx > 0) {
        const prefix = cmd.name.slice(0, colonIdx).trim();
        // Root-level prefixes (package manager names and turbo)
        const rootPrefixes = ['pnpm', 'npm', 'yarn', 'bun', 'turbo'];
        if (!rootPrefixes.includes(prefix)) {
          workspace = prefix;
        }
      }
    }

    const existing = groups.get(workspace) ?? [];
    existing.push(cmd);
    groups.set(workspace, existing);
  }

  // Sort: Root first, then alphabetically
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'Root') return -1;
    if (b === 'Root') return 1;
    return a.localeCompare(b);
  });

  return sorted.map(([label, cmds]) => ({
    label,
    commands: cmds,
  }));
}

// ─── Command Detail Panel ───────────────────────────────────────────────────

function CommandDetailPanel({
  command,
  isFavorite,
  onRun,
  onToggleFavorite,
}: {
  command: RunnableCommand;
  isFavorite: boolean;
  onRun: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4">
        <div className="text-center">
          <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            {command.name}
          </h3>
          <p className="text-xs text-chatroom-text-muted mt-1">
            Source: {command.source}
          </p>
        </div>

        <div className="bg-black/60 rounded p-3">
          <code className="text-xs font-mono text-green-400 break-all">
            $ {command.script}
          </code>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onRun}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            ▶ Run
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
      </div>
    </div>
  );
}
