'use client';

import { Eye, EyeOff, X } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface BacklogCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
}

export function BacklogCreateModal({ isOpen, onClose, onSubmit }: BacklogCreateModalProps) {
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setContent('');
      setShowPreview(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter or Ctrl+Enter to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-chatroom-bg-tertiary border-2 border-chatroom-border w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            Add Backlog Item
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                showPreview
                  ? 'bg-chatroom-accent text-chatroom-bg-primary'
                  : 'text-chatroom-text-muted hover:text-chatroom-text-primary'
              }`}
              title={showPreview ? 'Hide preview' : 'Show preview'}
            >
              {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
              Preview
            </button>
            <button
              onClick={onClose}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {showPreview ? (
            // Preview Mode - Side by side on larger screens, stacked on smaller
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
              {/* Editor */}
              <div className="flex-1 min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-chatroom-border">
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary">
                  Markdown
                </div>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Write your task description in markdown...

Example:
## Bug: Login fails on mobile
When users try to login on mobile devices, the form submits but nothing happens.

**Steps to reproduce:**
1. Open app on mobile
2. Enter credentials
3. Tap login button

**Expected:** User should be logged in
**Actual:** Nothing happens"
                  className="flex-1 w-full bg-chatroom-bg-primary text-chatroom-text-primary text-xs p-3 resize-none focus:outline-none font-mono"
                />
              </div>

              {/* Preview */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary">
                  Preview
                </div>
                <div className="flex-1 overflow-y-auto p-3 prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-code:text-xs prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-pre:bg-chatroom-bg-tertiary prose-pre:text-chatroom-text-primary">
                  {content.trim() ? (
                    <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                  ) : (
                    <p className="text-chatroom-text-muted italic">Preview will appear here...</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Edit Only Mode
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write your task description in markdown...

Example:
## Bug: Login fails on mobile
When users try to login on mobile devices, the form submits but nothing happens.

**Steps to reproduce:**
1. Open app on mobile
2. Enter credentials
3. Tap login button

**Expected:** User should be logged in
**Actual:** Nothing happens"
              className="flex-1 w-full bg-chatroom-bg-primary text-chatroom-text-primary text-xs p-4 resize-none focus:outline-none min-h-[300px]"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t-2 border-chatroom-border bg-chatroom-bg-tertiary">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add to Backlog'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
