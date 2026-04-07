'use client';

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

interface EditorModalProps {
  isOpen: boolean;
  initialValue: string;
  onClose: (editedText: string) => void;
  onSend: (text: string) => void;
}

/**
 * Full-screen modal editor with code-editor-like behavior.
 *
 * - Enter = newline
 * - Tab = 2 spaces
 * - Cmd/Ctrl+Enter = send
 * - Monospace font, large textarea
 */
export const EditorModal = memo(function EditorModal({
  isOpen,
  initialValue,
  onClose,
  onSend,
}: EditorModalProps) {
  const [text, setText] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync initial value when modal opens
  useEffect(() => {
    if (isOpen) {
      setText(initialValue);
      // Auto-focus textarea when modal opens
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        // Move cursor to end
        const len = initialValue.length;
        textareaRef.current?.setSelectionRange(len, len);
      });
    }
  }, [isOpen, initialValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab inserts 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newValue = text.substring(0, start) + '  ' + text.substring(end);
          setText(newValue);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
          });
        }
      }
      // Cmd/Ctrl+Enter sends
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (text.trim()) {
          onSend(text);
        }
      }
      // Escape closes
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(text);
      }
      // Enter = newline (default behavior, no preventDefault)
    },
    [text, onSend, onClose]
  );

  const handleClose = useCallback(() => {
    onClose(text);
  }, [onClose, text]);

  const handleSend = useCallback(() => {
    if (text.trim()) {
      onSend(text);
    }
  }, [text, onSend]);

  if (!isOpen) return null;

  return (
    <FixedModal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[80vw]">
      <FixedModalContent>
        <FixedModalHeader onClose={handleClose}>
          <FixedModalTitle>Editor</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody className="flex flex-col p-0">
          <div className="flex-1 p-4 flex flex-col min-h-0">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 min-h-[300px] max-h-[60vh] bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm px-4 py-3 resize-none overflow-auto font-mono leading-6 placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong"
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface">
            <span className="text-[10px] text-chatroom-text-muted">
              {typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
                ? '⌘'
                : 'Ctrl'}
              ↵ to send · Tab for indent · Esc to close
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim()}
              className="bg-chatroom-accent text-chatroom-bg-primary border-2 border-chatroom-accent px-5 py-2 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary hover:border-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
