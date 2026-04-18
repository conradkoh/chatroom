'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { X } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { exhaustive } from '@/lib/exhaustive';
import type {
  SavedCommand,
  SavedCommandCreateInput,
  SavedCommandType,
  SavedCommandUpdateInput,
} from '../types/savedCommand';
import { SAVED_COMMAND_TYPE_LABELS, SAVED_COMMAND_TYPES } from '../types/savedCommand';

interface SavedCommandModalProps {
  isOpen: boolean;
  chatroomId: string;
  onClose: () => void;
  onCreated?: () => void;
  /** When provided, the modal is in edit mode and pre-fills from this command. */
  initial?: SavedCommand;
  /** Names already in use in this chatroom (for duplicate prevention) */
  existingNames?: string[];
}

/**
 * Pure validation function — checks if a name would create a duplicate.
 * Returns an error string if duplicate, null if OK.
 */
export function checkDuplicateName(
  name: string,
  existingNames: string[],
  isEditMode: boolean,
  initialName?: string
): string | null {
  const lowerName = name.toLowerCase();
  const namesToCheck = isEditMode
    ? existingNames.filter((n) => n.toLowerCase() !== (initialName ?? '').toLowerCase())
    : existingNames;
  if (namesToCheck.some((n) => n.toLowerCase() === lowerName)) {
    return `A command named "${name}" already exists.`;
  }
  return null;
}

/**
 * Modal dialog for creating or editing a saved command (custom prompt).
 * When `initial` is provided, it operates in edit mode (pre-fills fields, calls updateSavedCommand).
 * Otherwise, it operates in create mode (calls createSavedCommand).
 */
export function SavedCommandModal({
  isOpen,
  chatroomId,
  onClose,
  onCreated,
  initial,
  existingNames = [],
}: SavedCommandModalProps) {
  const isEditMode = Boolean(initial);
  const [type, setType] = useState<SavedCommandType>(initial?.type ?? 'prompt');
  const [name, setName] = useState(initial?.name ?? '');
  const [promptText, setPromptText] = useState(
    initial?.type === 'prompt' ? initial.prompt : ''
  );
  const [nameError, setNameError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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

  // Focus trap: keep Tab/Shift+Tab within modal when open
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [isOpen]);

  // Populate fields when modal opens or reset when closed
  useEffect(() => {
    if (!isOpen) return;
    setType(initial?.type ?? 'prompt');
    setName(initial?.name ?? '');
    setPromptText(initial?.type === 'prompt' ? initial.prompt : '');
    setIsSubmitting(false);
    setNameError('');
  }, [isOpen, initial]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSubmitting) return;

    // Duplicate name check (case-insensitive)
    const dupErr = checkDuplicateName(trimmedName, existingNames, isEditMode, initial?.name);
    if (dupErr) {
      setNameError(dupErr);
      return;
    }

    // Build typed payload — validate and assemble per-type
    let createPayload: SavedCommandCreateInput;
    let updatePayload: SavedCommandUpdateInput;
    switch (type) {
      case 'prompt': {
        if (!promptText.trim()) return;
        createPayload = { type: 'prompt', name: trimmedName, prompt: promptText.trim() };
        updatePayload = { type: 'prompt', prompt: promptText.trim() };
        break;
      }
      default:
        exhaustive(type);
    }

    setIsSubmitting(true);
    try {
      if (isEditMode && initial) {
        await updateSavedCommand({
          commandId: initial._id,
          name: trimmedName,
          command: updatePayload,
        });
      } else {
        await createSavedCommand({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          command: createPayload,
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
    type,
    promptText,
    isSubmitting,
    isEditMode,
    initial,
    existingNames,
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

  // Determine if the per-type body is valid for submission
  const isTypeBodyValid = (() => {
    switch (type) {
      case 'prompt':
        return promptText.trim().length > 0;
      default:
        return exhaustive(type);
    }
  })();

  const canSubmit = name.trim().length > 0 && isTypeBodyValid && !isSubmitting;

  /** Render the type-specific fields below the Name input */
  const renderTypeBody = () => {
    switch (type) {
      case 'prompt':
        return (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="command-prompt"
              className="text-xs font-medium text-chatroom-text-secondary uppercase tracking-wider"
            >
              Prompt
            </label>
            <textarea
              id="command-prompt"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter the prompt text to send as a message..."
              rows={5}
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong transition-colors resize-none rounded-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-chatroom-text-muted">Tip: Press ⌘Enter to save quickly.</p>
          </div>
        );
      default:
        return exhaustive(type);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-command-modal-title"
        className="relative bg-chatroom-bg-tertiary border-2 border-chatroom-border w-full max-w-md mx-4 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border">
          <h2
            id="saved-command-modal-title"
            className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary"
          >
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
          {/* Type selector */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="command-type"
              className="text-xs font-medium text-chatroom-text-secondary uppercase tracking-wider"
            >
              Type
            </label>
            <select
              id="command-type"
              value={type}
              onChange={(e) => setType(e.target.value as SavedCommandType)}
              disabled={isEditMode || isSubmitting}
              className="w-full px-3 py-2 text-sm bg-chatroom-bg-primary border border-chatroom-border text-chatroom-text-primary focus:outline-none focus:border-chatroom-border-strong transition-colors rounded-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {SAVED_COMMAND_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SAVED_COMMAND_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

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

          {/* Type-specific body */}
          {renderTypeBody()}
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
