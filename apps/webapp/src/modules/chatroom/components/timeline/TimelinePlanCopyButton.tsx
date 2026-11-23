'use client';

import { Check, Copy } from 'lucide-react';

import { TIMELINE_PLAN_CONTROL, TIMELINE_PLAN_LABEL } from './timelineRowStyles';

import { cn } from '@/lib/utils';

export interface TimelinePlanCopyButtonProps {
  testId: string;
  /** Accessible name, e.g. "Copy plan id", "Copy P2 reference". */
  label: string;
  copied: boolean;
  failed: boolean;
  onCopy: () => void;
  /** Visible label for meta controls; `undefined` renders an icon-only control. */
  text?: string;
  className?: string;
}

/** Decorative status icon: check after a successful copy, clipboard otherwise. */
function CopyStatusIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return <Check size={12} aria-hidden="true" className="text-chatroom-status-success" />;
  }
  return <Copy size={12} aria-hidden="true" />;
}

/** Optional visible label. Renders nothing for the icon-only controls. */
function CopyLabel({ copied, text }: { copied: boolean; text?: string }) {
  if (text === undefined) return null;
  return <span className={TIMELINE_PLAN_LABEL}>{copied ? 'Copied' : text}</span>;
}

export function TimelinePlanCopyButton({
  testId,
  label,
  copied,
  failed,
  onCopy,
  text,
  className,
}: TimelinePlanCopyButtonProps) {
  const stateLabel = copied ? 'Copied' : label;
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-copied={copied}
        onClick={onCopy}
        aria-label={stateLabel}
        title={stateLabel}
        className={cn(TIMELINE_PLAN_CONTROL, 'shrink-0', className)}
      >
        <CopyLabel copied={copied} text={text} />
        <CopyStatusIcon copied={copied} />
      </button>
      {failed && <span className="text-[10px] text-chatroom-status-error">Copy failed</span>}
    </>
  );
}
