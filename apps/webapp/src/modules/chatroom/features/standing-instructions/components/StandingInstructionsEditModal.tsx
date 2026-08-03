'use client';

import { StandingInstructionsEditorDialog } from './StandingInstructionsEditorDialog';

export function StandingInstructionsEditModal({
  open,
  onOpenChange,
  initialTitle,
  initialContent,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialContent: string;
  onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
}) {
  return (
    <StandingInstructionsEditorDialog
      open={open}
      onOpenChange={onOpenChange}
      dialogTitle="Edit standing instruction"
      initialContent={initialContent}
      initialTitle={initialTitle}
      onConfirm={onConfirm}
    />
  );
}
