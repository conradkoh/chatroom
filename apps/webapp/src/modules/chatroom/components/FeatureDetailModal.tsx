'use client';

import { X, Sparkles, FileText, Code } from 'lucide-react';
import React, { useEffect, useCallback, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FeatureDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  techSpecs?: string;
}

/**
 * Modal for displaying feature metadata (title, description, tech specs).
 * Used when clicking on a feature title in new_feature messages.
 */
export const FeatureDetailModal = memo(function FeatureDetailModal({
  isOpen,
  onClose,
  title,
  description,
  techSpecs,
}: FeatureDetailModalProps) {
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

  if (!isOpen) {
    return null;
  }

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const hasDescription = description && description.trim().length > 0;
  const hasTechSpecs = techSpecs && techSpecs.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="chatroom-root fixed top-0 right-0 h-full w-full md:w-[500px] lg:w-[600px] bg-chatroom-bg-primary border-l-2 border-chatroom-border-strong z-50 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-chatroom-status-warning" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Feature Details
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Title Section */}
          <div>
            <h2 className="text-lg font-bold text-chatroom-text-primary mb-2">{title}</h2>
          </div>

          {/* Description Section */}
          {hasDescription && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileText size={14} className="text-chatroom-status-info" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Description
                </span>
              </div>
              <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                <Markdown remarkPlugins={[remarkGfm]}>{description}</Markdown>
              </div>
            </div>
          )}

          {/* Tech Specs Section */}
          {hasTechSpecs && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Code size={14} className="text-chatroom-status-success" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Technical Specifications
                </span>
              </div>
              <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                <Markdown remarkPlugins={[remarkGfm]}>{techSpecs}</Markdown>
              </div>
            </div>
          )}

          {/* Empty state if no description or tech specs */}
          {!hasDescription && !hasTechSpecs && (
            <div className="text-chatroom-text-muted text-sm italic">
              No additional details provided for this feature.
            </div>
          )}
        </div>
      </div>
    </>
  );
});
