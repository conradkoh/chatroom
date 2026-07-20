'use client';

import { useState } from 'react';

import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from '../../components/picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { MESSAGE_STORE_LIMIT } from '../../hooks/chatroomMessageStore';

import { useIsDesktop } from '@/hooks/useIsDesktop';

interface TimelineEventCountMenuProps {
  eventCount: number;
  canPurge: boolean;
  onPurge: () => void;
}

export function TimelineEventCountMenu({
  eventCount,
  canPurge,
  onPurge,
}: TimelineEventCountMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      disabled={!canPurge}
      className={
        'flex-shrink-0 text-[10px] text-chatroom-text-muted tabular-nums font-mono' +
        (canPurge
          ? ' cursor-pointer hover:text-chatroom-text-primary transition-colors'
          : ' cursor-default')
      }
      title={canPurge ? 'Timeline event options' : undefined}
      aria-label="Timeline event options"
    >
      {eventCount} EVENTS
    </button>
  );

  const handlePurge = () => {
    setOpen(false);
    onPurge();
  };

  if (!isDesktop) {
    return (
      <ResponsivePickerShell
        open={open}
        onOpenChange={setOpen}
        title="Timeline events"
        align="end"
        trigger={trigger}
      >
        <PickerScrollBody>
          <PickerOptionRow selected={false} onSelect={handlePurge} disabled={!canPurge}>
            <span>Purge loaded history</span>
          </PickerOptionRow>
          <p className="px-3 py-1.5 text-[10px] text-chatroom-text-muted">
            Keep only the most recent {MESSAGE_STORE_LIMIT} events in memory.
          </p>
        </PickerScrollBody>
      </ResponsivePickerShell>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[200px]">
        <DropdownMenuItem onSelect={handlePurge} disabled={!canPurge}>
          <span className="text-xs">Purge loaded history</span>
        </DropdownMenuItem>
        <p className="px-2 py-1 text-[10px] text-chatroom-text-muted">
          Keep only the most recent {MESSAGE_STORE_LIMIT} events in memory.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
