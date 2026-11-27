'use client';

import { CheckCircle, Download, MoreVertical } from 'lucide-react';
import type React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ChatroomActionsMenuProps {
  canArchive: boolean;
  exporting: boolean;
  /** Per-surface trigger hover colour: the grid card and the table row use different tokens. */
  triggerHoverClassName: string;
  onExport: (e: React.MouseEvent) => void;
  onArchive: (e: React.MouseEvent) => void;
}

/** Shared chatroom actions menu. Export is always available; Archive only for live chatrooms. */
export function ChatroomActionsMenu({
  canArchive,
  exporting,
  triggerHoverClassName,
  onExport,
  onArchive,
}: ChatroomActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={`w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary ${triggerHoverClassName} transition-all duration-100`}
        onClick={(e) => e.stopPropagation()}
        aria-label="Chatroom actions"
      >
        <MoreVertical size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuItem
          onClick={onExport}
          disabled={exporting}
          data-testid="chatroom-action-export"
        >
          <Download size={14} className="mr-2" />
          Export chatroom
        </DropdownMenuItem>
        {canArchive && (
          <DropdownMenuItem onClick={onArchive}>
            <CheckCircle size={14} className="mr-2" />
            Archive Chat
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
