import { AlertCircle, Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LogDimensionBadges } from './LogDimensionBadges';
import { LogLevelBadge } from './LogLevelBadge';

import type { LogLine } from '@/api/types';
import { Button } from '@/components/ui/button';
import { formatLocalLogDateTime } from '@/lib/format-local-timestamp';
import { formatLogLineAsXml } from '@/lib/log-line-xml';

/** How long the copy button keeps its success or failure icon. */
const COPY_FEEDBACK_DURATION_MS = 2000;

type CopyStatus = 'copied' | 'failed';

export function LogDetailPanel({
  line,
  chatroomName,
  onClose,
}: {
  line: LogLine;
  chatroomName?: string | undefined;
  onClose: () => void;
}) {
  // Remember which line produced the feedback, not a bare boolean, so the icon
  // is only shown for the line that was copied. The timer is keyed on the
  // feedback itself rather than on the current line, so switching lines does
  // not cancel the reset and leave a stale tick behind when the copied line is
  // selected again later.
  const [copyFeedback, setCopyFeedback] = useState<{
    line: LogLine;
    status: CopyStatus;
  } | null>(null);
  const copyStatus = copyFeedback?.line === line ? copyFeedback.status : null;

  // Revert the icon after a short delay, and clean the timer up so no state
  // update lands after unmount.
  useEffect(() => {
    if (copyFeedback === null) {
      return;
    }
    const timeoutId = setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [copyFeedback]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatLogLineAsXml(line, chatroomName));
      setCopyFeedback({ line, status: 'copied' });
    } catch (error) {
      console.error('Failed to copy log detail as XML:', error);
      setCopyFeedback({ line, status: 'failed' });
    }
  };

  const copyFeedbackLabel =
    copyStatus === 'copied' ? 'Copied as XML' : copyStatus === 'failed' ? 'Copy failed' : undefined;

  return (
    <aside
      className="flex w-96 max-w-[40%] shrink-0 flex-col border-l border-chatroom-border bg-chatroom-bg-primary"
      role="dialog"
      aria-modal="true"
      aria-label="Log detail"
    >
      <div className="flex items-center justify-between border-b border-chatroom-border px-4 py-3">
        <h3 className="text-sm font-medium">Log detail</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            aria-label="Copy log detail as XML"
            title={copyFeedbackLabel ?? 'Copy as XML'}
          >
            {copyStatus === 'copied' ? (
              <Check className="size-4" />
            ) : copyStatus === 'failed' ? (
              <AlertCircle className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
          <span className="sr-only" role="status" aria-live="polite">
            {copyFeedbackLabel ?? ''}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close detail panel">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <LogLevelBadge level={line.level} />
          <span className="text-chatroom-text-muted">{formatLocalLogDateTime(line.timestamp)}</span>
        </div>
        <LogDimensionBadges line={line} chatroomName={chatroomName} />
        <div className="text-chatroom-text-muted">
          Source: <span className="text-chatroom-text-primary">{line.source}</span>
          {line.stream && <> · Stream: {line.stream}</>}
          {line.id != null && <> · ID: {line.id}</>}
        </div>
        <pre className="whitespace-pre-wrap font-mono text-xs">{line.message}</pre>
        {line.metadata && Object.keys(line.metadata).length > 0 && (
          <div>
            <p className="mb-1 text-chatroom-text-muted">Metadata</p>
            <pre className="whitespace-pre-wrap border border-chatroom-border bg-chatroom-bg-secondary p-2 font-mono text-[11px]">
              {JSON.stringify(line.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}
