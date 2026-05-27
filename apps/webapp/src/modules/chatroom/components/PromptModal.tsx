'use client';

import { X } from 'lucide-react';
import React, { useEffect, useCallback, useState, memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { CopyButton } from './CopyButton';
import { fullMarkdownComponents, proseClassNames } from './markdown-utils';

import { usePrompts } from '@/contexts/PromptsContext';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: string;
}

type ViewMode = 'preview' | 'raw';

export const PromptModal = memo(function PromptModal({ isOpen, onClose, role }: PromptModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const { getAgentPrompt } = usePrompts();

  // Get the prompt for this role from context
  const prompt = getAgentPrompt(role) || '';

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
      <div className="chatroom-root fixed top-0 right-0 h-full w-full md:w-[500px] lg:w-[600px] bg-chatroom-bg-primary border-l-2 border-chatroom-border-strong z-50 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary">
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
        <div className="flex border-b-2 border-chatroom-border bg-chatroom-bg-primary">
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
            <div className={proseClassNames}>
              <Markdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={fullMarkdownComponents}
              >
                {prompt}
              </Markdown>
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
