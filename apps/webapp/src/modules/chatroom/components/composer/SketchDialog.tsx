'use client';

import { useCallback, useRef } from 'react';

import { Dialog, DialogContent } from '../ui/dialog';
import { SketchEditorSession } from './sketch/SketchEditorSession';

export type SketchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File) => void;
};

export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  const requestDismissRef = useRef<() => void>(() => onOpenChange(false));
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) onOpenChange(true);
      else requestDismissRef.current();
    },
    [onOpenChange]
  );
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        floating
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestDismissRef.current();
        }}
        className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-0 p-0 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] lg:h-[calc(100dvh-2rem)] lg:w-[calc(100vw-2rem)] lg:max-w-none"
      >
        <SketchEditorSession
          onDismiss={() => onOpenChange(false)}
          onSave={onSave}
          registerRequestDismiss={(requestDismiss) => {
            requestDismissRef.current = requestDismiss;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
