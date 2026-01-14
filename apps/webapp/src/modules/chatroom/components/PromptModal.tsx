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
      <div className="prompt-viewer-backdrop" onClick={handleBackdropClick} />

      {/* Side panel / Full screen viewer */}
      <div className="prompt-viewer">
        <div className="prompt-viewer-header">
          <div className="prompt-viewer-title">
            <span className="prompt-viewer-label">Agent Prompt</span>
            <span className="prompt-viewer-role">{role}</span>
          </div>
          <div className="prompt-viewer-actions">
            <CopyButton text={prompt} label="Copy" copiedLabel="Copied!" />
            <button className="prompt-viewer-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="prompt-viewer-toolbar">
          <div className="view-mode-toggle">
            <button
              className={`view-mode-button ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              Preview
            </button>
            <button
              className={`view-mode-button ${viewMode === 'raw' ? 'active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
        </div>

        <div className="prompt-viewer-content">
          {viewMode === 'preview' ? (
            <div className="prompt-viewer-markdown markdown-content">
              <Markdown remarkPlugins={[remarkGfm]}>{prompt}</Markdown>
            </div>
          ) : (
            <pre className="prompt-viewer-text">{prompt}</pre>
          )}
        </div>
      </div>
    </>
  );
});
