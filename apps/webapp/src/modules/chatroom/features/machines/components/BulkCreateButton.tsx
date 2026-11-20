'use client';

import type { RefObject } from 'react';

import { repositoryCount } from '../lib/bulkCreate';

import { Button } from '@/components/ui/button';

export interface BulkCreateButtonProps {
  /** No-chatroom rows matching the filter. */
  count: number;
  /** Null when the button can run. */
  disabledReason: string | null;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}

/** Bulk trigger for the visible no-chatroom rows; replaced by a done line when there are none. */
export function BulkCreateButton({
  count,
  disabledReason,
  buttonRef,
  onOpen,
}: BulkCreateButtonProps) {
  if (count === 0) {
    return (
      <p data-testid="bulk-create-done" className="text-xs text-chatroom-text-muted">
        Every repository shown has a chatroom.
      </p>
    );
  }
  return (
    <Button
      ref={buttonRef}
      data-testid="bulk-create-open"
      disabled={disabledReason !== null}
      onClick={onOpen}
      className="h-9 w-full bg-chatroom-accent px-4 text-xs font-bold uppercase tracking-wide text-chatroom-bg-primary hover:bg-chatroom-text-secondary sm:w-auto"
    >
      {disabledReason ?? `Create chatrooms for ${repositoryCount(count)}`}
    </Button>
  );
}
