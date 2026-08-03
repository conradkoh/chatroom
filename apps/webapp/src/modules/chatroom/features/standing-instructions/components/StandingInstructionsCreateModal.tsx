'use client';

import { useEffect, useState } from 'react';

import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

export function StandingInstructionsCreateModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
}) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    if (open) {
      setDraft('');
      setDraftTitle('');
    }
  }, [open]);

  const confirmDisabled = !draft.trim() || !draftTitle.trim();

  const handleConfirm = async () => {
    await onConfirm({ content: draft.trim(), title: draftTitle.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent
        floating
        className="sm:max-w-md max-h-[min(90dvh,100%)]"
        style={{ paddingBottom: keyboardInsetPx > 0 ? `${keyboardInsetPx}px` : undefined }}
      >
        <DialogHeader>
          <DialogTitle>Create standing instruction</DialogTitle>
        </DialogHeader>
        <StandingInstructionsEditorForm
          draft={draft}
          draftTitle={draftTitle}
          onDraftChange={setDraft}
          onDraftTitleChange={setDraftTitle}
          onConfirm={handleConfirm}
          onCancel={() => onOpenChange(false)}
          confirmDisabled={confirmDisabled}
          mobile={!isDesktop}
        />
      </DialogContent>
    </Dialog>
  );
}
