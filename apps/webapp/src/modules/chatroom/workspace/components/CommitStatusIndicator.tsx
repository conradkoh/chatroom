/**
 * CommitStatusIndicator — displays a colored dot for CI/CD check status
 * with a popover showing individual check run details.
 */

'use client';

import { memo } from 'react';
import { CheckCircle2, XCircle, Clock, MinusCircle } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { CommitStatusSummary } from '../types/git';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommitStatusIndicatorProps {
  status: CommitStatusSummary;
  /** Optional label shown next to the dot (e.g. branch name) */
  label?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusColor(state: string): string {
  switch (state) {
    case 'success':
      return 'bg-green-500 dark:bg-green-400';
    case 'failure':
      return 'bg-red-500 dark:bg-red-400';
    case 'pending':
    case 'in_progress':
      return 'bg-yellow-500 dark:bg-yellow-400';
    default:
      return 'bg-gray-400 dark:bg-gray-500';
  }
}

function getConclusionIcon(conclusion: string | null, status: string) {
  if (status !== 'completed') {
    return <Clock size={11} className="text-yellow-500 dark:text-yellow-400 shrink-0" />;
  }
  switch (conclusion) {
    case 'success':
      return <CheckCircle2 size={11} className="text-green-500 dark:text-green-400 shrink-0" />;
    case 'failure':
    case 'timed_out':
      return <XCircle size={11} className="text-red-500 dark:text-red-400 shrink-0" />;
    case 'skipped':
    case 'cancelled':
      return <MinusCircle size={11} className="text-gray-400 dark:text-gray-500 shrink-0" />;
    default:
      return <MinusCircle size={11} className="text-gray-400 dark:text-gray-500 shrink-0" />;
  }
}

function getConclusionLabel(conclusion: string | null, status: string): string {
  if (status !== 'completed') return status;
  return conclusion ?? 'unknown';
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CommitStatusIndicator = memo(function CommitStatusIndicator({
  status,
  label,
}: CommitStatusIndicatorProps) {
  const dotColor = getStatusColor(status.state);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary transition-colors font-mono uppercase tracking-wider px-1 py-0.5 rounded-none hover:bg-chatroom-bg-hover/50"
          title={`CI: ${status.state} (${status.totalCount} check${status.totalCount !== 1 ? 's' : ''})`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          {label && <span className="truncate max-w-[80px]">{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-auto min-w-[220px] max-w-[320px] p-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-chatroom-border-strong">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
            <span className="text-[11px] font-bold text-chatroom-text-primary uppercase tracking-wider">
              {status.state}
            </span>
            <span className="text-[10px] text-chatroom-text-muted ml-auto">
              {status.totalCount} check{status.totalCount !== 1 ? 's' : ''}
            </span>
          </div>
          {status.checkRuns.length > 0 ? (
            <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
              {status.checkRuns.map((run) => (
                <div
                  key={run.name}
                  className="flex items-center gap-1.5 px-1 py-0.5 text-[11px]"
                >
                  {getConclusionIcon(run.conclusion, run.status)}
                  <span className="text-chatroom-text-primary truncate flex-1">
                    {run.name}
                  </span>
                  <span className="text-chatroom-text-muted text-[10px] shrink-0">
                    {getConclusionLabel(run.conclusion, run.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-chatroom-text-muted px-1 py-0.5">
              No check runs found
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
