import { LogLevelBadge } from './LogLevelBadge';

import type { LogLine } from '@/api/types';

export function LogLineRow({ line }: { line: LogLine }) {
  const time = new Date(line.timestamp).toISOString().slice(11, 19);
  return (
    <div className="flex gap-3 whitespace-pre-wrap py-1">
      <span className="shrink-0 text-chatroom-text-muted">{time}</span>
      <LogLevelBadge level={line.level} />
      <span className="shrink-0 text-chatroom-text-muted">{line.source}</span>
      <span className="min-w-0">{line.message}</span>
    </div>
  );
}
