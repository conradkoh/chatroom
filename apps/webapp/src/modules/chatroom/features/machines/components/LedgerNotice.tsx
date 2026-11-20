'use client';

import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

/** Warning/error callout shared by ledger failures and snapshot banners. */
export function LedgerNotice({
  tone = 'warning',
  testId,
  children,
}: {
  tone?: 'warning' | 'error';
  testId?: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === 'error' ? 'text-chatroom-status-error' : 'text-chatroom-status-warning';
  return (
    <div
      data-testid={testId}
      className={`flex items-start gap-2 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 p-3 text-xs ${toneClass}`}
    >
      <AlertTriangle
        size={14}
        className="mt-0.5 shrink-0 text-chatroom-status-warning"
        aria-hidden
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
