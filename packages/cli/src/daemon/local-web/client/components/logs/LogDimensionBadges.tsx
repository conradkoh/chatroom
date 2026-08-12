import type { LogLine } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { getLogChatroomId, getLogHarness, getLogRole } from '@/lib/log-line';

export function LogDimensionBadges({
  line,
  chatroomName,
}: {
  line: LogLine;
  chatroomName?: string;
}) {
  const c = getLogChatroomId(line);
  const r = getLogRole(line);
  const h = getLogHarness(line);
  if (!c && !r && !h) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-1">
      {c && (
        <Badge variant="outline" className="text-chatroom-text-secondary">
          {chatroomName ?? c}
        </Badge>
      )}
      {r && (
        <Badge variant="outline" className="text-chatroom-status-info">
          {r}
        </Badge>
      )}
      {h && (
        <Badge variant="outline" className="text-chatroom-text-secondary">
          {h}
        </Badge>
      )}
    </div>
  );
}
