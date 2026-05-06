'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionParamsPopoverProps {
  harnessSessionRowId: Id<'chatroom_harnessSessions'>;
  workspaceId: Id<'chatroom_workspaces'>;
  harnessName: string;
  lastUsedConfig: {
    agent: string;
    model?: { providerID: string; modelID: string };
    system?: string;
    tools?: Record<string, boolean>;
  };
}

// ─── SessionParamsPopover ─────────────────────────────────────────────────────

export function SessionParamsPopover({
  lastUsedConfig,
}: SessionParamsPopoverProps) {
  // Config is now per-message — display only, no editing.
  // SessionParamsPopover is kept as a simple read-only badge.
  const displayText = (() => {
    const agent = lastUsedConfig.agent;
    const model = lastUsedConfig.model;
    if (model) return `${agent} · ${model.modelID}`;
    return agent;
  })();

  return (
    <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
      {displayText}
    </span>
  );
}
