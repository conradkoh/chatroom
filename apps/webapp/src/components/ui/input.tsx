import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { chatroomIndustrialInputClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

const NATIVE_DATE_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const isNativeDateInput = type !== undefined && NATIVE_DATE_INPUT_TYPES.has(type);

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      {...(isNativeDateInput ? { 'data-native-date-input': true } : {})}
      className={cn(
        'h-9 w-full min-w-0 px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-chatroom-text-primary placeholder:text-chatroom-text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-chatroom-status-error md:text-sm',
        chatroomIndustrialInputClassName,
        className
      )}
      {...props}
    />
  );
}

export { Input };
