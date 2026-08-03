'use client';

import { StandingInstructionsEditorDialog } from './StandingInstructionsEditorDialog';

export function StandingInstructionsCreateModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
}) {
  return (
    <StandingInstructionsEditorDialog
      open={open}
      onOpenChange={onOpenChange}
      dialogTitle="Create standing instruction"
      initialContent=""
      initialTitle=""
      onConfirm={onConfirm}
      closeOnConfirm
    />
  );
}
