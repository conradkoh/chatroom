import { ChatroomSelect } from './ChatroomSelect';
import { DimensionSelect } from './DimensionSelect';

import type { ChatroomListItem } from '@/api/types';
import type { LogTimePreset } from '@/lib/log-time-range';
import { TimeRangeFilter } from './TimeRangeFilter';

export type LogFilterValues = { chatroomId?: string; role?: string; harness?: string; timeRange?: LogTimePreset; fromMs?: number; toMs?: number };
type Props = {
  chatrooms: ChatroomListItem[];
  chatroomsLoading?: boolean;
  chatroomsError?: boolean;
  roles: string[];
  harnesses: string[];
  values: LogFilterValues;
  onChange: (v: LogFilterValues) => void;
  disabled?: boolean;
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
      <TimeRangeFilter value={{timeRange: values.timeRange, fromMs: values.fromMs, toMs: values.toMs}} onChange={(time)=>onChange({...values,...time})} disabled={disabled}/>
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
