'use client';

import { AlertCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';

import type { NoticeTone } from './remoteFolderBrowserCopy';

/**
 * Tone styles mirror the tones in `components/inline-feedback.tsx`, so a notice looks like the
 * rest of the app's feedback. That component has no action slot, so the notice cannot reuse it.
 */
const TONE: Record<NoticeTone, { box: string; Icon: LucideIcon }> = {
  error: {
    box: 'border-chatroom-status-error/40 bg-chatroom-status-error/10 text-chatroom-status-error',
    Icon: AlertCircle,
  },
  warning: {
    box: 'border-chatroom-status-warning/40 bg-chatroom-status-warning/10 text-chatroom-status-warning',
    Icon: AlertTriangle,
  },
  info: {
    box: 'border-chatroom-status-info/40 bg-chatroom-status-info/10 text-chatroom-status-info',
    Icon: Info,
  },
};

/** One inline notice in the browser. Errors use `role="alert"`; other tones are polite. */
export function RemoteFolderBrowserNotice({
  tone,
  message,
  action,
  testId,
}: {
  tone: NoticeTone;
  message: string;
  action?: { label: string; onClick: () => void };
  testId?: string;
}) {
  const { box, Icon } = TONE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={`mx-2 mt-2 flex items-start gap-2 border px-2.5 py-2 text-xs ${box}`}
    >
      <Icon size={14} aria-hidden className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="h-8 shrink-0 border border-current px-2 text-[10px] font-bold uppercase tracking-wider hover:bg-chatroom-bg-hover sm:h-7"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
