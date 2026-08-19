import type { ChatroomListItem } from '@/api/types';
import { ChatroomSelect } from '@/components/logs/ChatroomSelect';
import { TimeRangeFilter } from '@/components/logs/TimeRangeFilter';
import type { EventStreamFilterValues } from '@/lib/event-stream-filters-url';

type Props = {
  chatrooms: ChatroomListItem[];
  chatroomsLoading?: boolean;
  chatroomsError?: boolean;
  values: EventStreamFilterValues;
  onChange: (v: EventStreamFilterValues) => void;
  disabled?: boolean;
};
export function EventStreamFiltersBar({
  chatrooms,
  chatroomsLoading,
  chatroomsError,
  values,
  onChange,
  disabled,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TimeRangeFilter
        value={{ timeRange: values.timeRange, fromMs: values.fromMs, toMs: values.toMs }}
        onChange={(time) => onChange({ ...values, ...time })}
        disabled={disabled}
      />
      <ChatroomSelect
        chatrooms={chatrooms}
        value={values.chatroomId}
        onChange={(chatroomId) => onChange({ ...values, chatroomId })}
        disabled={disabled}
        isLoading={chatroomsLoading}
        isError={chatroomsError}
      />
    </div>
  );
}
