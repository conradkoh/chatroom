'use client';

import { StandingInstructionsEditorDialog } from './StandingInstructionsEditorDialog';

export function StandingInstructionsEditModal({
  open,
  onOpenChange,
  initialTitle,
  initialContent,
  onConfirm,
  showApplyToAllChatrooms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialContent: string;
  onConfirm: (payload: {
    content: string;
    title: string;
    applyToAllChatrooms?: boolean;
  }) => void | Promise<void>;
  /** Show the "apply to all my chatrooms" checkbox for history-template edits. */
  showApplyToAllChatrooms?: boolean;
}) {
  return (
    <StandingInstructionsEditorDialog
      open={open}
      onOpenChange={onOpenChange}
      dialogTitle="Edit standing instruction"
      initialContent={initialContent}
      initialTitle={initialTitle}
      onConfirm={onConfirm}
      showApplyToAllChatrooms={showApplyToAllChatrooms}
    />
  );
}
