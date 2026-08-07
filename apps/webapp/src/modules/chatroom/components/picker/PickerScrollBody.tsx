'use client';

import { cn } from '@/lib/utils';

export interface PickerScrollBodyProps {
  children: React.ReactNode;
  className?: string;
  maxHeightClassName?: string;
}

export function PickerScrollBody({
  children,
  className,
  maxHeightClassName = 'max-h-[60vh]',
}: PickerScrollBodyProps) {
  return (
    <div
      data-picker-scroll-body
      className={cn('min-h-0 overflow-y-auto overscroll-contain', maxHeightClassName, className)}
    >
      {children}
    </div>
  );
}
