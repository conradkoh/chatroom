import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PickerOptionRow } from '@/components/picker/PickerOptionRow';
import {
  filterSelectTriggerClassName,
  filterSelectTriggerChevronClassName,
} from '@/components/picker/pickerTriggerStyles';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DEFAULT_LOG_TIME_PRESET,
  fromDatetimeLocalValue,
  getTimeRangeLabel,
  LOG_TIME_PRESET_LABELS,
  LOG_TIME_PRESET_MS,
  type LogTimeFilterValues,
  type LogTimePreset,
  toDatetimeLocalValue,
} from '@/lib/log-time-range';
import { cn } from '@/lib/utils';

const PRESETS: Exclude<LogTimePreset, 'custom'>[] = ['1h', '3h', '1d'];
type Props = {
  value: LogTimeFilterValues;
  onChange: (v: LogTimeFilterValues) => void;
  disabled?: boolean;
};
export function TimeRangeFilter({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const p = value.timeRange ?? DEFAULT_LOG_TIME_PRESET;
  useEffect(() => {
    if (p === 'custom' && value.fromMs !== undefined && value.toMs !== undefined) {
      setFrom(toDatetimeLocalValue(value.fromMs));
      setTo(toDatetimeLocalValue(value.toMs));
    }
  }, [p, value.fromMs, value.toMs]);
  const startCustom = () => {
    const now = Date.now();
    const f = value.fromMs ?? now - LOG_TIME_PRESET_MS['1h'];
    const t = value.toMs ?? now;
    setFrom(toDatetimeLocalValue(f));
    setTo(toDatetimeLocalValue(t));
    onChange({ timeRange: 'custom', fromMs: f, toMs: t });
  };
  const apply = () => {
    const f = fromDatetimeLocalValue(from);
    const t = fromDatetimeLocalValue(to);
    if (f === undefined || t === undefined || f > t) return;
    onChange({ timeRange: 'custom', fromMs: f, toMs: t });
    setOpen(false);
  };
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-chatroom-text-muted">Time</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              className={cn(filterSelectTriggerClassName, 'min-w-[10rem]')}
              aria-label="Filter by time range"
            >
              <span className="truncate">{getTimeRangeLabel(value)}</span>
              <ChevronDown size={12} className={filterSelectTriggerChevronClassName} />
            </button>
          }
        />
        <PopoverContent className="w-72 p-0" align="start">
          {PRESETS.map((x) => (
            <PickerOptionRow
              key={x}
              selected={p === x}
              onSelect={() => {
                onChange({ timeRange: x, fromMs: undefined, toMs: undefined });
                setOpen(false);
              }}
            >
              {LOG_TIME_PRESET_LABELS[x]}
            </PickerOptionRow>
          ))}
          <PickerOptionRow selected={p === 'custom'} onSelect={startCustom}>
            Custom range…
          </PickerOptionRow>
          {p === 'custom' && (
            <div className="space-y-2 border-t border-chatroom-border px-3 py-2">
              <label className="flex flex-col gap-1 text-[11px] text-chatroom-text-muted">
                Start
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-none border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1 text-xs text-chatroom-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-chatroom-text-muted">
                End
                <input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-none border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1 text-xs text-chatroom-text-primary"
                />
              </label>
              <button
                type="button"
                onClick={apply}
                className="w-full border border-chatroom-border bg-chatroom-bg-tertiary px-2 py-1.5 text-xs hover:bg-chatroom-bg-hover"
              >
                Apply
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </label>
  );
}
