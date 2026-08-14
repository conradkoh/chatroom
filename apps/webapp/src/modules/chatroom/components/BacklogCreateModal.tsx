'use client';

import React, { useState, useCallback, useEffect } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';
import { ChatroomMarkdownEditorShell } from './chatroom-markdown-editor';

interface BacklogCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
}

export function BacklogCreateModal({ isOpen, onClose, onSubmit }: BacklogCreateModalProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setContent('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(content.trim());
      onClose();
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [content, isSubmitting, onSubmit, onClose]);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl" className="sm:max-h-[80vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>Add Backlog Item</FixedModalTitle>
        </FixedModalHeader>

        <FixedModalBody className="flex flex-col p-0 overflow-hidden">
          <ChatroomMarkdownEditorShell
            editorKey={isOpen ? 'create-open' : 'create-closed'}
            defaultMarkdown={content}
            onChange={setContent}
            placeholder="Write your task description in markdown..."
            autoFocus
            onModEnter={handleSubmit}
            modEnterDisabled={isSubmitting || !content.trim()}
            className="flex-1 flex flex-col min-h-0"
          />
        </FixedModalBody>

        <div className="flex items-center gap-2 px-4 py-3 border-t-2 border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Adding...' : 'Add to Backlog'}
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
