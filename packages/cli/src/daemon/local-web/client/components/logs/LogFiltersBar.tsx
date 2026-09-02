import { ChatroomSelect } from './ChatroomSelect';
import { DimensionSelect } from './DimensionSelect';
import { TimeRangeFilter } from './TimeRangeFilter';

import type { ChatroomListItem } from '@/api/types';
import type { LogTimePreset } from '@/lib/log-time-range';

export type LogFilterValues = {
  chatroomId?: string | undefined;
  role?: string | undefined;
  harness?: string | undefined;
  timeRange?: LogTimePreset | undefined;
  fromMs?: number | undefined;
  toMs?: number | undefined;
};
type Props = {
  chatrooms: ChatroomListItem[];
  chatroomsLoading?: boolean | undefined;
  chatroomsError?: boolean | undefined;
  roles: string[];
  harnesses: string[];
  values: LogFilterValues;
  onChange: (v: LogFilterValues) => void;
  disabled?: boolean | undefined;
};
export function LogFiltersBar({
  chatrooms,
  chatroomsLoading,
  chatroomsError,
  roles,
  harnesses,
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
      <DimensionSelect
        label="Role"
        options={roles}
        value={values.role}
        onChange={(role) => onChange({ ...values, role })}
        disabled={disabled}
        allLabel="All roles"
      />
      <DimensionSelect
        label="Harness"
        options={harnesses}
        value={values.harness}
        onChange={(harness) => onChange({ ...values, harness })}
        disabled={disabled}
        allLabel="All harnesses"
      />
    </div>
  );
}
