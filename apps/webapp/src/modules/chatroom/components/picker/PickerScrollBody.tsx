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
  return <div className={cn('overflow-y-auto', maxHeightClassName, className)}>{children}</div>;
}
