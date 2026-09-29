import * as React from 'react';

import { cn } from '@/lib/utils';
import { chatroomIndustrialInputClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-chatroom-status-error md:text-sm',
        chatroomIndustrialInputClassName,
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
