'use client';

import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { DropdownMenuItem } from '../../components/ui/dropdown-menu';

import { cn } from '@/lib/utils';

interface WorkspaceDropdownMenuItemProps extends ComponentProps<typeof DropdownMenuItem> {
  icon: LucideIcon;
}

export function WorkspaceDropdownMenuItem({
  icon: Icon,
  children,
  className,
  ...props
}: WorkspaceDropdownMenuItemProps) {
  return (
    <DropdownMenuItem className={cn('text-chatroom-text-primary', className)} {...props}>
      <Icon className="size-3.5 shrink-0 text-chatroom-text-secondary" aria-hidden />
      <span className="min-w-0">{children}</span>
    </DropdownMenuItem>
  );
}
