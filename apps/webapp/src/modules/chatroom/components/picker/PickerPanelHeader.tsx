'use client';

import { cn } from '@/lib/utils';

export interface PickerPanelHeaderProps {
  title: string;
  children?: React.ReactNode;
  className?: string;
}

export function PickerPanelHeader({ title, children, className }: PickerPanelHeaderProps) {
  return (
    <div
      className={cn(
        'px-3 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary flex items-center justify-between',
        className
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
        {title}
      </span>
      {children}
    </div>
  );
}
