import { LogDimensionBadges } from './LogDimensionBadges';
import { LogLevelBadge } from './LogLevelBadge';

import type { LogLine } from '@/api/types';
import { getLogHarness } from '@/lib/log-line';
import { cn } from '@/lib/utils';

type Props = {
  line: LogLine;
  chatroomName?: string | undefined;
  selected?: boolean | undefined;
  onSelect?:( (line: LogLine) => void) | undefined;
};
export function LogLineRow({ line, chatroomName, selected, onSelect }: Props) {
  const time = new Date(line.timestamp).toISOString().slice(11, 19);
  const harness = getLogHarness(line);
  const showSource = !harness || !line.source.startsWith('harness:');
  const activate = () => onSelect?.(line);
  return (
    <div
      className={cn(
        'flex gap-3 rounded-none px-1 py-1.5 -mx-1',
        onSelect && 'cursor-pointer hover:bg-chatroom-bg-hover',
        selected && 'bg-chatroom-bg-hover'
      )}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? activate : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
              }
            }
          : undefined
      }
    >
      <span className="shrink-0 text-chatroom-text-muted">{time}</span>
      <LogLevelBadge level={line.level} />
      <LogDimensionBadges line={line} chatroomName={chatroomName} />
      {showSource && <span className="shrink-0 text-chatroom-text-muted">{line.source}</span>}
      <span className="min-w-0 flex-1 line-clamp-2">{line.message}</span>
    </div>
  );
}
