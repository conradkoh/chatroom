'use client';

import { X } from 'lucide-react';
import React, { useEffect, useCallback, useState, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CopyButton } from './CopyButton';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: string;
  prompt: string;
}

type ViewMode = 'preview' | 'raw';

export const PromptModal = memo(function PromptModal({
  isOpen,
  onClose,
  role,
  prompt,
}: PromptModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Reset view mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewMode('preview');
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  // Handle backdrop click (mobile only - on desktop the backdrop is smaller)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop for mobile */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Side panel / Full screen viewer */}
      <div className="fixed top-0 right-0 h-full w-full md:w-[500px] lg:w-[600px] bg-chatroom-bg-primary border-l-2 border-chatroom-border-strong z-50 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Agent Prompt
            </span>
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              {role}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={prompt} label="Copy" copiedLabel="Copied!" />
            <button
              className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex border-b-2 border-chatroom-border">
          <button
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-100 border-b-2 -mb-0.5 ${
              viewMode === 'preview'
                ? 'text-chatroom-accent border-chatroom-accent'
                : 'text-chatroom-text-muted border-transparent hover:text-chatroom-text-secondary'
            }`}
            onClick={() => setViewMode('preview')}
          >
            Preview
          </button>
          <button
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-100 border-b-2 -mb-0.5 ${
              viewMode === 'raw'
                ? 'text-chatroom-accent border-chatroom-accent'
                : 'text-chatroom-text-muted border-transparent hover:text-chatroom-text-secondary'
            }`}
            onClick={() => setViewMode('raw')}
          >
            Raw
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'preview' ? (
            <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
              <Markdown remarkPlugins={[remarkGfm]}>{prompt}</Markdown>
            </div>
          ) : (
            <pre className="text-chatroom-text-secondary text-xs font-mono whitespace-pre-wrap break-words leading-relaxed bg-chatroom-bg-tertiary p-4 border-2 border-chatroom-border">
              {prompt}
            </pre>
          )}
        </div>
      </div>
    </>
  );
});
