import type { LogLevel } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-chatroom-text-muted border-chatroom-border',
  info: 'text-chatroom-status-info border-chatroom-status-info/40',
  warn: 'text-chatroom-status-warning border-chatroom-status-warning/40',
  error: 'text-chatroom-status-error border-chatroom-status-error/40',
};
export function LogLevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge variant="outline" className={cn('font-mono uppercase', LEVEL_CLASS[level])}>
      {level}
    </Badge>
  );
}
