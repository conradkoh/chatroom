'use client';
import { useCallback, useEffect, useState } from 'react';

import { detailModalRichTextEditorProseClassNames } from './detail-modal';
import { RichTextEditor } from './detail-modal-shared';

import { InlineFeedback } from '@/components/inline-feedback';
import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';
import { useFeedback } from '@/hooks/useFeedback';

export function QueueFrontMessageModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { feedback, error: showError, clear } = useFeedback();
  useEffect(() => {
    if (!isOpen) {
      setContent('');
      setSubmitting(false);
      clear();
    }
  }, [isOpen, clear]);
  const submit = useCallback(async () => {
    if (!content.trim() || submitting) return;
    clear();
    setSubmitting(true);
    try {
      await onSubmit(content.trim());
      onClose();
    } catch (err) {
      console.error('Failed to add message to front of queue:', err);
      showError('Failed to add message to front of queue');
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, onSubmit, onClose, clear, showError]);
  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl" className="sm:max-h-[80vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>Add to Front of Queue</FixedModalTitle>
        </FixedModalHeader>
        <InlineFeedback
          feedback={feedback}
          onDismiss={clear}
          data-testid="queue-front-feedback"
          className="mx-4 mt-3 shrink-0"
        />
        <FixedModalBody className="flex flex-col p-0 overflow-hidden">
          <RichTextEditor
            value={content}
            onChange={(value) => {
              setContent(value);
              clear();
            }}
            placeholder="Write a message..."
            autoFocus
            onCmdEnter={submit}
            className="flex-1 flex flex-col min-h-0"
            proseClassName={detailModalRichTextEditorProseClassNames}
          />
        </FixedModalBody>
        <div className="flex items-center gap-2 px-4 py-3 border-t-2 border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
          <button
            type="button"
            disabled={!content.trim() || submitting}
            onClick={submit}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Adding...' : 'Add to Queue'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </FixedModalContent>
    </FixedModal>
  );
}
