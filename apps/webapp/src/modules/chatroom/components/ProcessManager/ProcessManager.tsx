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

import { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { CommandBrowser } from './CommandBrowser';
import { ProcessList } from './ProcessList';
import { OutputPanel } from './OutputPanel';

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

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearchQuery('');
  }, [open]);

  // Group commands by category (extract prefix before ':')
  const groupedCommands = groupCommandsByCategory(commands, searchQuery);

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
                {/* Running Processes (always at top) */}
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

            {/* Right panel — Terminal output */}
            <div className="flex-1 flex flex-col overflow-hidden">
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

  // Group by category prefix (e.g., "pnpm:", "turbo:", "chatroom-cli:")
  const groups = new Map<string, RunnableCommand[]>();

  for (const cmd of filtered) {
    const colonIdx = cmd.name.indexOf(':');
    const category = colonIdx > 0 ? cmd.name.slice(0, colonIdx).trim() : 'Other';
    const existing = groups.get(category) ?? [];
    existing.push(cmd);
    groups.set(category, existing);
  }

  return Array.from(groups.entries()).map(([label, cmds]) => ({
    label,
    commands: cmds,
  }));
}
