'use client';

import { CalendarIcon } from 'lucide-react';
import * as React from 'react';

import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DatePickerProps = {
  date?: Date;
  onSelect?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

function DatePicker({
  date,
  onSelect,
  placeholder = 'Pick a date',
  disabled,
  className,
  id,
}: DatePickerProps) {
  return (
    <Popover modal>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs',
          'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          !date && 'text-muted-foreground',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
      >
        <CalendarIcon className="mr-2 size-4 shrink-0" />
        {date ? date.toLocaleDateString() : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  );
}

type DatePickerFieldProps = DatePickerProps & {
  label: string;
};

function DatePickerField({ label, id, ...props }: DatePickerFieldProps) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="min-h-9">
        <DatePicker id={id} {...props} />
      </div>
    </div>
  );
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PART_PATTERN = /^\d{1,2}$/;

/** Local calendar date as `YYYY-MM-DD`, zero-padded. */
function formatIsoDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Strict `YYYY-MM-DD` → local-midnight Date. Returns undefined for anything that is
 * not a real calendar day (round-trip check rejects 2026-02-30, 2026-13-01, 0050-…).
 */
function parseIsoDate(text: string): Date | undefined {
  const match = ISO_DATE_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

/** `HH:mm` for hour 0–23 and minute 0–59 typed as 1–2 digits; undefined otherwise. */
function toTimeOfDay(hour: string, minute: string): string | undefined {
  if (!TIME_PART_PATTERN.test(hour) || !TIME_PART_PATTERN.test(minute)) return undefined;
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Composes the `runAtLocal` contract `'YYYY-MM-DDTHH:mm'`, or `''` when any part is missing or out of range. */
function composeLocalDateTime(d: Date | undefined, hour: string, minute: string): string {
  const time = toTimeOfDay(hour, minute);
  return d && time ? `${formatIsoDate(d)}T${time}` : '';
}

type DateInputProps = {
  value?: Date;
  /** Receives a local-midnight Date for valid text, the picked day, or undefined when the text is not a valid date. */
  onChange: (date: Date | undefined) => void;
  /** Reports the invalid flag after blur or edits. Used by DateTimeField for its hint. */
  onInvalidChange?: (invalid: boolean) => void;
  /** Calendar only: disables days before the local start of `min`. Typed text is not restricted. */
  min?: Date;
  disabled?: boolean;
  size?: 'default' | 'compact';
  id?: string;
  placeholder?: string;
  /** Wrapper class. */
  className?: string;
  /** Applied to the text input. Callers pass chatroom tokens. */
  inputClassName?: string;
  'aria-label'?: string;
  /** Applied to the text input. The calendar button gets `${testId}-calendar`. */
  'data-testid'?: string;
};

function DateInput({
  value,
  onChange,
  onInvalidChange,
  min,
  disabled,
  size = 'default',
  id,
  placeholder = 'YYYY-MM-DD',
  className,
  inputClassName,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DateInputProps) {
  const compact = size === 'compact';
  const [draft, setDraft] = React.useState<string | null>(null);
  const [invalid, setInvalidState] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const text = draft ?? (value ? formatIsoDate(value) : '');

  const updateInvalid = (next: boolean) => {
    if (next === invalid) return;
    setInvalidState(next);
    onInvalidChange?.(next);
  };

  const emit = (next: Date | undefined) => {
    if (!next && !value) return;
    if (next && value && formatIsoDate(next) === formatIsoDate(value)) return;
    onChange(next);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    updateInvalid(false);
    emit(parseIsoDate(e.target.value));
  };

  const handleBlur = () => {
    const parsed = parseIsoDate(text);
    if (parsed || value) {
      setDraft(null);
      updateInvalid(false);
    } else {
      updateInvalid(text.trim() !== '');
    }
  };

  const handleSelect = (d: Date | undefined) => {
    setDraft(null);
    updateInvalid(false);
    emit(d);
    setOpen(false);
  };

  return (
    <div className={cn('relative inline-flex', compact ? 'w-[6.5rem]' : 'w-36', className)}>
      <Input
        id={id}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(
          compact ? 'h-6 px-1.5 pr-6 text-[10px] md:text-[10px]' : 'pr-9 text-xs md:text-xs',
          'tabular-nums',
          inputClassName
        )}
      />
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          aria-label="Open calendar"
          data-testid={testId ? `${testId}-calendar` : undefined}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center justify-center text-chatroom-text-muted outline-none hover:text-chatroom-text-primary focus-visible:text-chatroom-text-primary disabled:pointer-events-none disabled:opacity-50',
            compact ? 'w-6' : 'w-8'
          )}
        >
          <CalendarIcon className={compact ? 'size-3' : 'size-4'} />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            required
            selected={value}
            defaultMonth={value ?? min}
            disabled={
              min
                ? { before: new Date(min.getFullYear(), min.getMonth(), min.getDate()) }
                : undefined
            }
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

type DateTimeFieldProps = {
  /** `'YYYY-MM-DDTHH:mm'` or `''`. Read on mount only. The parent owns the composed value afterwards. */
  value: string;
  /** Composed `'YYYY-MM-DDTHH:mm'`, or `''` when the date or time is incomplete or out of range. */
  onChange: (value: string) => void;
  min?: Date;
  disabled?: boolean;
  /** Applied to the date text input so a `<label htmlFor>` targets it. */
  id?: string;
  /** Adds data-testids: `${p}-date`, `${p}-date-calendar`, `${p}-hour`, `${p}-minute`. */
  testIdPrefix?: string;
  inputClassName?: string;
};

const RUN_AT_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

function DateTimeField({
  value,
  onChange,
  min,
  disabled,
  id,
  testIdPrefix,
  inputClassName,
}: DateTimeFieldProps) {
  const [initial] = React.useState(() => RUN_AT_PREFIX_PATTERN.exec(value));
  const [date, setDate] = React.useState<Date | undefined>(() =>
    initial ? parseIsoDate(initial[1]) : undefined
  );
  const [hour, setHour] = React.useState(initial?.[2] ?? '');
  const [minute, setMinute] = React.useState(initial?.[3] ?? '');
  const [timeTouched, setTimeTouched] = React.useState(false);
  const [dateInvalid, setDateInvalid] = React.useState(false);
  const timeInvalid = timeTouched && toTimeOfDay(hour, minute) === undefined;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-start gap-2">
        <DateInput
          id={id}
          value={date}
          min={min}
          disabled={disabled}
          aria-label="Date"
          data-testid={testIdPrefix ? `${testIdPrefix}-date` : undefined}
          inputClassName={inputClassName}
          onInvalidChange={setDateInvalid}
          onChange={(d) => {
            setDate(d);
            onChange(composeLocalDateTime(d, hour, minute));
          }}
        />
        <div className="flex items-center gap-1">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={23}
            aria-label="Hour"
            data-testid={testIdPrefix ? `${testIdPrefix}-hour` : undefined}
            value={hour}
            disabled={disabled}
            aria-invalid={timeInvalid || undefined}
            onBlur={() => setTimeTouched(true)}
            onChange={(e) => {
              setHour(e.target.value);
              onChange(composeLocalDateTime(date, e.target.value, minute));
            }}
            className={cn('w-16 text-center text-xs tabular-nums', inputClassName)}
          />
          <span className="text-xs text-chatroom-text-muted">:</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            aria-label="Minute"
            data-testid={testIdPrefix ? `${testIdPrefix}-minute` : undefined}
            value={minute}
            disabled={disabled}
            aria-invalid={timeInvalid || undefined}
            onBlur={() => setTimeTouched(true)}
            onChange={(e) => {
              setMinute(e.target.value);
              onChange(composeLocalDateTime(date, hour, e.target.value));
            }}
            className={cn('w-16 text-center text-xs tabular-nums', inputClassName)}
          />
        </div>
      </div>
      {dateInvalid && <p className="text-[10px] text-chatroom-status-error">Use YYYY-MM-DD</p>}
      {timeInvalid && (
        <p className="text-[10px] text-chatroom-status-error">Hour 0–23, minute 0–59</p>
      )}
    </div>
  );
}

export {
  DatePicker,
  DatePickerField,
  DateInput,
  DateTimeField,
  formatIsoDate,
  parseIsoDate,
  composeLocalDateTime,
  type DatePickerProps,
  type DatePickerFieldProps,
  type DateInputProps,
  type DateTimeFieldProps,
};
