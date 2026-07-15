'use client';

import { Copy, MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';
import type { WorkspaceFileMenuProps } from './types';

import { cn } from '@/lib/utils';

export interface WorkspaceFileActionsMenuProps extends WorkspaceFileMenuProps {
  className?: string;
  triggerVariant?: 'copy' | 'more';
}

export const WorkspaceFileActionsMenu = memo(function WorkspaceFileActionsMenu({
  className,
  triggerVariant = 'copy',
  ...menuProps
}: WorkspaceFileActionsMenuProps) {
  const isMoreTrigger = triggerVariant === 'more';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 min-w-8 min-h-8 flex items-center justify-center rounded-sm',
            className
          )}
          aria-label={isMoreTrigger ? 'More copy options' : 'Copy file'}
          title={isMoreTrigger ? 'More copy options' : 'Copy file'}
        >
          {isMoreTrigger ? (
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <WorkspaceFileMenuItems {...menuProps} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
