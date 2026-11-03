'use client';

import { CalendarClock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export interface SendScheduleMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The send button. The menu is positioned against it. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** Element to refocus on dismiss: the textarea for pointer/touch opens, the send button for keyboard opens. */
  restoreFocusRef: RefObject<HTMLElement | null>;
  onSchedule: () => void;
}

/**
 * Controlled, trigger-less menu anchored to the send button. The composer owns
 * the gesture; this component only renders the single "Schedule message" item.
 * Choosing the item suppresses the usual focus restore so the scheduler dialog
 * keeps focus; dismissing restores focus to the originating element.
 */
export function SendScheduleMenu({
  open,
  onOpenChange,
  anchorRef,
  restoreFocusRef,
  onSchedule,
}: SendScheduleMenuProps) {
  const selectedRef = useRef(false);
  const itemRef = useRef<HTMLDivElement | null>(null);

  // The menu has no trigger, so Base UI does not move focus into it on open.
  // Focus the only item after the menu's own focus settling, so keyboard
  // navigation and Escape work.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => itemRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) selectedRef.current = false;
        onOpenChange(next);
      }}
    >
      <DropdownMenuContent
        anchor={anchorRef}
        side="top"
        align="end"
        sideOffset={8}
        className="min-w-[11rem]"
        data-testid="send-schedule-menu"
        finalFocus={() =>
          selectedRef.current ? false : (restoreFocusRef.current ?? anchorRef.current)
        }
      >
        <DropdownMenuItem
          ref={itemRef}
          data-testid="send-schedule-menu-item"
          className="gap-2"
          onClick={() => {
            selectedRef.current = true;
            onOpenChange(false);
            onSchedule();
          }}
        >
          <CalendarClock size={14} aria-hidden className="shrink-0 text-chatroom-text-muted" />
          Schedule message
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
