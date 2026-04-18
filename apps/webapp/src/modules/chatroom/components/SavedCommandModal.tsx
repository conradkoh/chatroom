'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useCallback, useEffect, useRef } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface SavedCommandModalProps {
  isOpen: boolean;
  chatroomId: string;
  onClose: () => void;
  onCreated?: () => void;
  /** When provided, the modal is in edit mode */
  commandId?: string;
  initialName?: string;
  initialPrompt?: string;
}

/**
 * Modal dialog for creating or editing a saved command (custom prompt).
 * When `commandId` is provided, it operates in edit mode (pre-fills name/prompt, calls updateSavedCommand).
 * Otherwise, it operates in create mode (calls createSavedCommand).
 */
export function SavedCommandModal({
  isOpen,
  chatroomId,
  onClose,
  onCreated,
  commandId,
  initialName,
  initialPrompt,
}: SavedCommandModalProps) {
  const isEditMode = Boolean(commandId);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const createSavedCommand = useSessionMutation(api.savedCommands.createSavedCommand);
  const updateSavedCommand = useSessionMutation(api.savedCommands.updateSavedCommand);

  // Focus name input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Populate fields when modal opens (edit mode) or reset when closed
  useEffect(() => {
    if (isOpen) {
      setName(initialName ?? '');
      setPrompt(initialPrompt ?? '');
      setIsSubmitting(false);
    } else {
      setName('');
      setPrompt('');
      setIsSubmitting(false);
    }
  }, [isOpen, initialName, initialPrompt]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !prompt.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (isEditMode && commandId) {
        await updateSavedCommand({
          commandId: commandId as Id<'chatroom_savedCommands'>,
          name: trimmedName,
          prompt: prompt.trim(),
        });
      } else {
        await createSavedCommand({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          name: trimmedName,
          prompt: prompt.trim(),
        });
      }
      onCreated?.();
      onClose();
    } catch (error) {
      console.error('Failed to save command:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    name,
    prompt,
    isSubmitting,
    isEditMode,
    commandId,
    updateSavedCommand,
    createSavedCommand,
    chatroomId,
    onCreated,
    onClose,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const canSubmit = name.trim().length > 0 && prompt.trim().length > 0 && !isSubmitting;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-chatroom-bg-surface border-chatroom-border text-chatroom-text-primary max-w-md">
        <DialogHeader>
          <DialogTitle className="text-chatroom-text-primary text-base font-semibold">
            {isEditMode ? 'Edit Command' : 'Create Command'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="command-name"
              className="text-xs font-medium text-chatroom-text-secondary uppercase tracking-wider"
            >
              Name
            </label>
            <input
              ref={nameInputRef}
              id="command-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Summarize thread"
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong transition-colors"
              disabled={isSubmitting}
            />
          </div>

          {/* Prompt field */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="command-prompt"
              className="text-xs font-medium text-chatroom-text-secondary uppercase tracking-wider"
            >
              Prompt
            </label>
            <textarea
              id="command-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter the prompt text to send as a message..."
              rows={5}
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong transition-colors resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-chatroom-text-muted">Tip: Press ⌘Enter to save quickly.</p>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider border border-chatroom-border text-chatroom-text-secondary hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-chatroom-accent text-chatroom-bg-primary border border-chatroom-accent hover:bg-chatroom-text-secondary hover:border-chatroom-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Command'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
