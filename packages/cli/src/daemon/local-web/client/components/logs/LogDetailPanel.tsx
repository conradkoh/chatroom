import { X } from 'lucide-react';

import { LogDimensionBadges } from './LogDimensionBadges';
import { LogLevelBadge } from './LogLevelBadge';

import type { LogLine } from '@/api/types';
import { Button } from '@/components/ui/button';
import { formatLocalLogDateTime } from '@/lib/format-local-timestamp';

export function LogDetailPanel({
  line,
  chatroomName,
  onClose,
}: {
  line: LogLine;
  chatroomName?: string | undefined;
  onClose: () => void;
}) {
  return (
    <aside
      className="flex w-96 max-w-[40%] shrink-0 flex-col border-l border-chatroom-border bg-chatroom-bg-primary"
      role="dialog"
      aria-modal="true"
      aria-label="Log detail"
    >
      <div className="flex items-center justify-between border-b border-chatroom-border px-4 py-3">
        <h3 className="text-sm font-medium">Log detail</h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close detail panel">
          <X className="size-4" />
        </Button>
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
