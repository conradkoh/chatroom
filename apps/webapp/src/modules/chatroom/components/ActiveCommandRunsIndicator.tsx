/**
 * ActiveCommandRunsIndicator
 *
 * A small status-bar pill that shows active (running/pending) background command
 * processes for the current machine + workingDir. Renders nothing when there are
 * no active runs.
 *
 * Clicking the pill re-attaches the inline output panel to the most recent
 * active run and opens the Command Palette so the user can see the output.
 */

'use client';

import { Terminal } from 'lucide-react';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import { api } from '@workspace/backend/convex/_generated/api';
import { useCommandDialog } from '../context/CommandDialogContext';
import type { InlineCommandState } from '../hooks/useInlineCommandOutput';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveCommandRunsIndicatorProps {
  machineId: string;
  workingDir: string;
  inlineCommand: InlineCommandState;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActiveCommandRunsIndicator({
  machineId,
  workingDir,
  inlineCommand,
}: ActiveCommandRunsIndicatorProps) {
  const { openDialog } = useCommandDialog();

  const activeRuns = useSessionQuery(api.commands.listActiveRuns, {
    machineId,
    workingDir,
  });

  // Render nothing when there are no active runs
  if (!activeRuns || activeRuns.length === 0) {
    return null;
  }

  const count = activeRuns.length;
  const tooltip = activeRuns.map((r) => r.commandName).join(', ');
  const mostRecent = activeRuns[0];

  const handleClick = () => {
    // Re-attach the inline panel to the most recent active run
    inlineCommand.attach(mostRecent._id, mostRecent.commandName, mostRecent.script);
    // Open the command palette so the user can see the output
    openDialog('command-palette');
  };

  return (
    <button
      onClick={handleClick}
      title={`Active: ${tooltip}`}
      aria-label={`${count} active command run${count !== 1 ? 's' : ''}: ${tooltip}`}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium
        bg-blue-500/15 text-blue-600 dark:text-blue-400
        hover:bg-blue-500/25 transition-colors cursor-pointer
        border border-blue-500/20"
    >
      <Terminal size={11} className="shrink-0 animate-pulse" />
      <span>{count}</span>
    </button>
  );
}
