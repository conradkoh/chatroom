'use client';

import { memo, type ReactNode } from 'react';

export interface HarnessModelConfigRowProps {
  harnessLabel: string;
  modelLabel: string;
  starred?: boolean;
  disabled?: boolean;
  onApply: () => void;
  actions: ReactNode;
}

export const HarnessModelConfigRow = memo(function HarnessModelConfigRow({
  harnessLabel,
  modelLabel,
  starred = false,
  disabled = false,
  onApply,
  actions,
}: HarnessModelConfigRowProps) {
  const title = `${harnessLabel} / ${modelLabel}`;

  return (
    <div className="flex items-center gap-1 min-w-0 px-1.5 py-1 bg-chatroom-bg-tertiary border border-chatroom-border">
      <button
        type="button"
        disabled={disabled}
        onClick={onApply}
        className="flex-1 min-w-0 text-left hover:text-chatroom-accent disabled:opacity-50"
        title={title}
      >
        <div className="flex gap-1 min-w-0">
          {starred && (
            <span className="shrink-0 text-[11px] text-chatroom-status-warning leading-tight">
              ★
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-chatroom-text-primary">{modelLabel}</div>
            <div className="truncate text-[10px] text-chatroom-text-muted">{harnessLabel}</div>
          </div>
        </div>
      </button>
      {actions}
    </div>
  );
});
