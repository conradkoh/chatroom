import { Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LogDimensionBadges } from './LogDimensionBadges';
import { LogLevelBadge } from './LogLevelBadge';

import type { LogLine } from '@/api/types';
import { Button } from '@/components/ui/button';
import { formatLocalLogDateTime } from '@/lib/format-local-timestamp';
import { formatLogLineAsXml } from '@/lib/log-line-xml';

export function LogDetailPanel({
  line,
  chatroomName,
  onClose,
}: {
  line: LogLine;
  chatroomName?: string | undefined;
  onClose: () => void;
}) {
  // Track which line was copied rather than a bare boolean, so selecting a
  // different line immediately clears the success icon instead of showing it
  // for the new line.
  const [copiedLine, setCopiedLine] = useState<LogLine | null>(null);
  const copied = copiedLine === line;

  // Revert the success icon after a short delay, and always clean the timer up
  // so no state update lands after unmount or after the line changes.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeoutId = setTimeout(() => setCopiedLine(null), 2000);
    return () => clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatLogLineAsXml(line, chatroomName));
      setCopiedLine(line);
    } catch (error) {
      console.error('Failed to copy log detail as XML:', error);
    }
  };

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
            title="Copy as XML"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
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
