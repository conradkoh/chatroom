'use client';

import { Check, Copy, MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';

import type { WorkspaceFileMenuProps } from './types';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCopiedIndicator } from '@/hooks/useCopiedIndicator';
import { cn } from '@/lib/utils';

export interface WorkspaceFileActionsMenuProps extends WorkspaceFileMenuProps {
  className?: string;
  triggerVariant?: 'copy' | 'more';
}

function TriggerIcon({ copied, isMoreTrigger }: { copied: boolean; isMoreTrigger: boolean }) {
  if (copied) return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (isMoreTrigger) return <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />;
  return <Copy className="h-3.5 w-3.5" aria-hidden />;
}

export const WorkspaceFileActionsMenu = memo(function WorkspaceFileActionsMenu({
  className,
  triggerVariant = 'copy',
  handlers,
  ...menuProps
}: WorkspaceFileActionsMenuProps) {
  const isMoreTrigger = triggerVariant === 'more';
  const { copied, markCopied } = useCopiedIndicator();
  const menuHandlers = useMemo(
    () => ({
      ...handlers,
      onCopied: () => {
        markCopied();
        handlers.onCopied?.();
      },
    }),
    [handlers, markCopied]
  );

  const triggerLabel = isMoreTrigger ? 'More copy options' : 'Copy file';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 min-w-8 min-h-8 flex items-center justify-center rounded-sm',
          className
        )}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <TriggerIcon copied={copied} isMoreTrigger={isMoreTrigger} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <WorkspaceFileMenuItems {...menuProps} handlers={menuHandlers} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
