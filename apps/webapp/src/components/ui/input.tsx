import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { chatroomIndustrialInputClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

const NATIVE_DATE_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

/**
 * Native temporal input types. iOS Safari renders these with unreliable width and alignment.
 * Do not use in product UI; use DatePickerField from @/components/ui/date-picker.
 */
type NativeTemporalInputType = 'date' | 'datetime-local' | 'month' | 'time' | 'week';

/** Every HTML input type except the native temporal ones. */
type InputType =
  | 'button'
  | 'checkbox'
  | 'color'
  | 'email'
  | 'file'
  | 'hidden'
  | 'image'
  | 'number'
  | 'password'
  | 'radio'
  | 'range'
  | 'reset'
  | 'search'
  | 'submit'
  | 'tel'
  | 'text'
  | 'url';

type InputProps = Omit<React.ComponentProps<'input'>, 'type'> & { type?: InputType };
type NativeTemporalInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  type: NativeTemporalInputType;
};

/** Private implementation shared by both public wrappers. Not exported. */
function BaseInput({ className, type, ...props }: React.ComponentProps<'input'>) {
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

function Input(props: InputProps) {
  return <BaseInput {...props} />;
}

/**
 * Escape hatch for the developer component harness and diagnostics ONLY.
 * Do not use in product UI; use DatePickerField instead.
 */
function NativeTemporalInput(props: NativeTemporalInputProps) {
  return <BaseInput {...props} />;
}

export { Input, NativeTemporalInput, type InputProps, type NativeTemporalInputType };
