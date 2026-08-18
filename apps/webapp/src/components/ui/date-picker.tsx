'use client';

import { CalendarIcon } from 'lucide-react';
import * as React from 'react';

import { Calendar } from '@/components/ui/calendar';
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

export { DatePicker, DatePickerField, type DatePickerProps, type DatePickerFieldProps };
