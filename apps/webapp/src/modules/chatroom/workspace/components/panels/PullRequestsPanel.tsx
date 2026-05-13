'use client';

import { memo } from 'react';
import { SiGithub } from 'react-icons/si';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PullRequestsPanelProps {
  machineId: string;
  workingDir: string;
  chatroomId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Pull Requests panel — GitHub PR browser.
 *
 * Default filter: user's open PRs.
 * Default selected: current branch's PR (if any).
 * Drill-into: full PR review with diff.
 *
 * Implementation in progress — currently renders a placeholder.
 */
export const PullRequestsPanel = memo(function PullRequestsPanel({
  machineId: _machineId,
  workingDir: _workingDir,
  chatroomId: _chatroomId,
}: PullRequestsPanelProps) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground min-h-0">
      <div className="flex flex-col items-center gap-3">
        <SiGithub size={40} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Pull Requests — coming soon</p>
      </div>
    </div>
  );
});
