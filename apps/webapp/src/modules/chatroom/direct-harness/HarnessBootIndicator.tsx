'use client';

/**
 * HarnessBootIndicator — shown while a session is in pending or spawning state.
 */

import { Loader2 } from 'lucide-react';

export function HarnessBootIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/50 rounded-sm border border-border">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span>Harness is starting…</span>
    </div>
  );
}
