'use client';

import {
  X,
  Sparkles,
  FileText,
  Code,
  HelpCircle,
  RotateCcw,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';
import React, { useEffect, useCallback, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents } from './markdown-utils';

interface Message {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  classification?: 'question' | 'new_feature' | 'follow_up';
  taskId?: string;
  taskStatus?: 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';
  featureTitle?: string;
  featureDescription?: string;
  featureTechSpecs?: string;
}

interface MessageDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: Message | null;
}

// Get classification icon and label
const getClassificationDisplay = (classification: Message['classification']) => {
  switch (classification) {
    case 'question':
      return {
        icon: <HelpCircle size={16} className="text-chatroom-status-info" />,
        label: 'Question',
      };
    case 'new_feature':
      return {
        icon: <Sparkles size={16} className="text-chatroom-status-warning" />,
        label: 'New Feature',
      };
    case 'follow_up':
      return {
        icon: <RotateCcw size={16} className="text-chatroom-text-muted" />,
        label: 'Follow-up',
      };
    default:
      return {
        icon: <MessageSquare size={16} className="text-chatroom-text-muted" />,
        label: 'Message',
      };
  }
};

/**
 * Modal for displaying message details.
 * - For new_feature: shows title, description, tech specs
 * - For question/follow_up: shows sender, target, timestamp, full message content
 * Slides in from the right, consistent with FeatureDetailModal.
 */
export const MessageDetailModal = memo(function MessageDetailModal({
  isOpen,
  onClose,
  message,
}: MessageDetailModalProps) {
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

  if (!isOpen || !message) {
    return null;
  }

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const isNewFeature = message.classification === 'new_feature';
  const classificationDisplay = getClassificationDisplay(message.classification);
  const hasDescription = message.featureDescription && message.featureDescription.trim().length > 0;
  const hasTechSpecs = message.featureTechSpecs && message.featureTechSpecs.trim().length > 0;

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

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
            {classificationDisplay.icon}
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              {classificationDisplay.label} Details
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
          {/* Message Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-chatroom-text-muted pb-4 border-b border-chatroom-border">
            {/* Sender → Target */}
            <div className="flex items-center gap-1.5">
              <span className="font-bold uppercase text-chatroom-text-primary">
                {message.senderRole}
              </span>
              {message.targetRole && (
                <>
                  <ArrowRight size={12} className="text-chatroom-text-muted" />
                  <span className="font-bold uppercase text-chatroom-text-primary">
                    {message.targetRole}
                  </span>
                </>
              )}
            </div>
            {/* Timestamp */}
            <span className="font-mono text-[10px]">{formatTime(message._creationTime)}</span>
          </div>

          {isNewFeature ? (
            // New Feature: show title, description, tech specs
            <>
              {/* Title Section */}
              {message.featureTitle && (
                <div>
                  <h2 className="text-lg font-bold text-chatroom-text-primary mb-2">
                    {message.featureTitle}
                  </h2>
                </div>
              )}

              {/* Description Section */}
              {hasDescription && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={14} className="text-chatroom-status-info" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                      Description
                    </span>
                  </div>
                  <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                    <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
                      {message.featureDescription}
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
                  <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                    <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
                      {message.featureTechSpecs}
                    </Markdown>
                  </div>
                </div>
              )}

              {/* Original Message Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className="text-chatroom-text-muted" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                    Original Message
                  </span>
                </div>
                <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                  <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
                    {message.content}
                  </Markdown>
                </div>
              </div>
            </>
          ) : (
            // Question/Follow-up: show full message content
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={14} className="text-chatroom-text-muted" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Full Message
                </span>
              </div>
              <div className="text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary">
                <Markdown remarkPlugins={[remarkGfm]} components={fullMarkdownComponents}>
                  {message.content}
                </Markdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
});
