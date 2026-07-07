'use client';

import { Loader2 } from 'lucide-react';

export function SetupWorkspaceLoadingPanel() {
  return (
    <div className="flex items-center justify-center py-12 text-chatroom-text-muted">
      <Loader2 size={18} className="animate-spin mr-2" />
      <span className="text-sm">Loading machines...</span>
    </div>
  );
}
