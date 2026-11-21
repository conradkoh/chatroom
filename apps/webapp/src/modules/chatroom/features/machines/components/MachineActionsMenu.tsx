'use client';

import { MoreHorizontal } from 'lucide-react';
import React from 'react';

import type { MachineAction } from './machineActions';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface MachineActionsMenuProps {
  actions: MachineAction[];
  triggerRef?: React.Ref<HTMLButtonElement>;
}

/**
 * Descriptor-driven per-card actions menu. Safe actions render first; destructive
 * ones follow a separator. Items are never disabled — an online machine still opens
 * the delete dialog in its blocked variant.
 */
export function MachineActionsMenu({ actions, triggerRef }: MachineActionsMenuProps) {
  const safeActions = actions.filter((action) => !action.destructive);
  const destructiveActions = actions.filter((action) => action.destructive);

  const renderItem = (action: MachineAction) => (
    <DropdownMenuItem
      key={action.id}
      data-testid={`machine-action-${action.id}`}
      onSelect={action.onSelect}
      className={action.destructive ? 'text-chatroom-status-error' : undefined}
    >
      <action.icon size={14} />
      {action.label}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label="Machine actions"
        data-testid="machine-actions-trigger"
        className="flex h-10 w-10 items-center justify-center text-chatroom-text-muted hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary sm:h-8 sm:w-8"
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      {/* Actions move focus themselves (inline editor, dialog); returning it to the
          trigger would steal it from the control the action just opened. */}
      <DropdownMenuContent align="end" finalFocus={false}>
        {safeActions.map(renderItem)}
        {destructiveActions.length > 0 && <DropdownMenuSeparator />}
        {destructiveActions.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
