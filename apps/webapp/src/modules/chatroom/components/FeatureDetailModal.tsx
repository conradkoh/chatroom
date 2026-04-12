'use client';

import { X, Sparkles, FileText, Code } from 'lucide-react';
import React, { useEffect, useCallback, memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents, proseClassNames } from './markdown-utils';

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
              <div className={proseClassNames}>
                <Markdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={fullMarkdownComponents}
                >
                  {description}
                </Markdown>
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
              <div className={proseClassNames}>
                <Markdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={fullMarkdownComponents}
                >
                  {techSpecs}
                </Markdown>
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
