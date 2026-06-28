'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionSummary } from '@workspace/backend/src/domain/direct-harness/types';

import { useEditableSessionTitle } from './useEditableSessionTitle';

import { inlineEditableTitleInputClassName } from '@/components/inline-editable-title/inline-editable-title-styles';
import { InlineEditableTitle } from '@/components/inline-editable-title/InlineEditableTitle';
import { cn } from '@/lib/utils';

const MAX_TITLE_LENGTH = 200;

interface EditableSessionTitleProps {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  sessionSummary: HarnessSessionSummary;
  className?: string;
}

export function EditableSessionTitle({
  harnessSessionId,
  sessionSummary,
  className,
}: EditableSessionTitleProps) {
  const {
    displayTitle,
    editedTitle,
    setEditedTitle,
    isEditing,
    isPending,
    startEditing,
    handleCancel,
    handleSave,
  } = useEditableSessionTitle(harnessSessionId, sessionSummary);

  return (
    <InlineEditableTitle
      value={displayTitle}
      editedValue={editedTitle}
      onEditedValueChange={setEditedTitle}
      isEditing={isEditing}
      onStartEdit={startEditing}
      onCancel={handleCancel}
      onSave={() => void handleSave()}
      isPending={isPending}
      maxLength={MAX_TITLE_LENGTH}
      editButtonTitle="Rename session"
      saveButtonTitle="Save title"
      inputAriaLabel="Session title"
      displayClassName="text-sm font-bold text-foreground truncate min-w-0 normal-case tracking-normal"
      inputClassName={cn(
        inlineEditableTitleInputClassName,
        'w-max min-w-[8rem] max-w-full normal-case tracking-normal text-sm'
      )}
      containerClassName={cn('w-max max-w-full min-w-0', className)}
    />
  );
}
