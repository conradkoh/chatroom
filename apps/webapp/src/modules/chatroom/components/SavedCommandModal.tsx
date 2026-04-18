'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { X } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

interface SavedCommandModalProps {
  isOpen: boolean;
  chatroomId: string;
  onClose: () => void;
  onCreated?: () => void;
  /** When provided, the modal is in edit mode */
  commandId?: string;
  initialName?: string;
  initialPrompt?: string;
  /** Names already in use in this chatroom (for duplicate prevention) */
  existingNames?: string[];
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
  existingNames = [],
}: SavedCommandModalProps) {
  const isEditMode = Boolean(commandId);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [nameError, setNameError] = useState('');
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

  // Handle Escape key to dismiss
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Populate fields when modal opens (edit mode) or reset when closed
  useEffect(() => {
    if (isOpen) {
      setName(initialName ?? '');
      setPrompt(initialPrompt ?? '');
      setIsSubmitting(false);
      setNameError('');
    } else {
      setName('');
      setPrompt('');
      setIsSubmitting(false);
      setNameError('');
    }
  }, [isOpen, initialName, initialPrompt]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !prompt.trim() || isSubmitting) return;

    // Duplicate name check (case-insensitive)
    const lowerName = trimmedName.toLowerCase();
    const namesToCheck = isEditMode
      ? existingNames.filter((n) => n.toLowerCase() !== (initialName ?? '').toLowerCase())
      : existingNames;
    if (namesToCheck.some((n) => n.toLowerCase() === lowerName)) {
      setNameError(`A command named "${trimmedName}" already exists.`);
      return;
    }

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
      toast.error('Failed to save command. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    name,
    prompt,
    isSubmitting,
    isEditMode,
    commandId,
    existingNames,
    initialName,
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-chatroom-bg-tertiary border-2 border-chatroom-border w-full max-w-md mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            {isEditMode ? 'Edit Command' : 'Create Command'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 px-4 py-4 bg-chatroom-bg-primary">
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
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Summarize thread"
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong transition-colors rounded-none"
              disabled={isSubmitting}
            />
            {nameError && <p className="text-xs text-red-500 dark:text-red-400">{nameError}</p>}
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
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong transition-colors resize-none rounded-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-chatroom-text-muted">Tip: Press ⌘Enter to save quickly.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t-2 border-chatroom-border bg-chatroom-bg-tertiary">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Command'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
