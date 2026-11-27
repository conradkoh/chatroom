'use client';

import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { ImportDialog } from './ImportDialog';

import { Button } from '@/components/ui/button';

interface ImportChatroomsButtonProps {
  variant: 'icon' | 'header' | 'empty';
}

/**
 * One of the three import entry points. The dialog is mounted only while open,
 * so everything it loaded (file, selection, results) belongs to that opening and
 * is discarded when it closes. Closing returns focus to this button.
 */
// fallow-ignore-next-line complexity
export function ImportChatroomsButton({ variant }: ImportChatroomsButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openDialog = () => setOpen(true);
  const closeDialog = () => setOpen(false);

  return (
    <>
      {variant === 'icon' && (
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-sm"
          aria-label="Import chatrooms"
          title="Import chatrooms"
          data-testid="import-open-sidebar"
          onClick={openDialog}
        >
          <Upload size={14} />
        </Button>
      )}
      {variant === 'header' && (
        <Button
          ref={triggerRef}
          variant="outline"
          className="h-auto px-4 py-2 text-xs font-bold uppercase tracking-wide"
          data-testid="import-open-header"
          onClick={openDialog}
        >
          <Upload size={14} /> Import
        </Button>
      )}
      {variant === 'empty' && (
        <Button
          ref={triggerRef}
          variant="ghost"
          className="mt-3 text-xs font-bold uppercase tracking-wide"
          data-testid="import-open-empty"
          onClick={openDialog}
        >
          Import from file
        </Button>
      )}
      {open && <ImportDialog onClose={closeDialog} finalFocusRef={triggerRef} />}
    </>
  );
}
