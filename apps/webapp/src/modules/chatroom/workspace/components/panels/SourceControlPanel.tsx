'use client';

import { memo } from 'react';
import { VscSourceControl } from 'react-icons/vsc';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceControlPanelProps {
  machineId: string;
  workingDir: string;
  chatroomId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Source Control panel — 3-column git interface.
 *
 * Column 1 (slim left): stacked diff summary (current changes) + commit history
 * Column 2 (middle): file list for the selected diff/commit
 * Column 3 (right): file diff viewer
 *
 * Implementation in progress — currently renders a placeholder.
 */
export const SourceControlPanel = memo(function SourceControlPanel({
  machineId: _machineId,
  workingDir: _workingDir,
  chatroomId: _chatroomId,
}: SourceControlPanelProps) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground min-h-0">
      <div className="flex flex-col items-center gap-3">
        <VscSourceControl size={40} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Source Control — coming soon</p>
      </div>
    </div>
  );
});
