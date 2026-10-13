'use client';

import { Loader2 } from 'lucide-react';

interface SetupWorkspaceLoadingPanelProps {
  label?: string;
}

export function SetupWorkspaceLoadingPanel({
  label = 'Loading machines...',
}: SetupWorkspaceLoadingPanelProps) {
  return (
    <div className="flex flex-1 items-center justify-center py-12 text-chatroom-text-muted">
      <Loader2 size={18} className="animate-spin mr-2" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
