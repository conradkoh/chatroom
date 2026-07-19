'use client';

import { BookOpen } from 'lucide-react';
import { useState } from 'react';

import {
  PickerOptionRow,
  PickerScrollBody,
  ResponsivePickerShell,
} from '@/modules/chatroom/components/picker';

const BAR_SHELL =
  'min-h-9 px-3 py-1.5 border border-chatroom-status-success/15 bg-chatroom-status-success/5 flex items-center gap-2 w-full text-left';

export function StandingInstructionsBarSection() {
  const [open, setOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider">Standing instructions bar</h2>
      <p className="text-[10px] text-chatroom-text-muted">
        Full-width native button + ResponsivePickerShell (asChild regression harness).
      </p>
      <ResponsivePickerShell
        open={open}
        onOpenChange={setOpen}
        title="Standing instructions"
        align="start"
        contentClassName="w-56 p-0"
        trigger={
          <button type="button" data-testid="open-standing-instructions-bar" className={BAR_SHELL}>
            <BookOpen size={12} className="shrink-0 text-chatroom-status-success" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-success">
              Standing instructions
            </span>
            <span className="text-xs text-chatroom-text-secondary truncate flex-1">
              Always use TypeScript
            </span>
          </button>
        }
      >
        <PickerScrollBody>
          <PickerOptionRow
            selected={false}
            onSelect={() => {
              setLastAction('edit');
              setOpen(false);
            }}
          >
            Edit
          </PickerOptionRow>
          <PickerOptionRow
            selected={false}
            onSelect={() => {
              setLastAction('disable');
              setOpen(false);
            }}
          >
            Disable
          </PickerOptionRow>
          <PickerOptionRow
            selected={false}
            onSelect={() => {
              setLastAction('delete');
              setOpen(false);
            }}
          >
            <span className="text-destructive">Delete</span>
          </PickerOptionRow>
        </PickerScrollBody>
      </ResponsivePickerShell>
      {lastAction ? (
        <div data-testid="standing-instructions-last-action" className="text-[10px]">
          {lastAction}
        </div>
      ) : null}
    </section>
  );
}
