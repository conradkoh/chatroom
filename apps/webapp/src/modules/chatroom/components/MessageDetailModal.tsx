'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import {
  Sparkles,
  FileText,
  Code,
  HelpCircle,
  Loader2,
  Pencil,
  RotateCcw,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents, proseClassNames } from './markdown-utils';

import type { Message } from '../types/message';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

interface MessageDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: Message | null;
  /**
   * When true, an Edit button is shown so the user can update the message content.
   * Only pass this for mutable messages (e.g. queued messages). Already-sent
   * messages (MessageFeed, etc.) should remain read-only.
   */
  editable?: boolean;
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
 * Modal for displaying (and optionally editing) message details.
 * Uses the same portaled `FixedModal` pattern as backlog / pending-review modals
 * so it is not clipped by narrow sidebars (`overflow-hidden`).
 *
 * Pass `editable` to enable inline editing (queued messages only).
 */
export const MessageDetailModal = memo(function MessageDetailModal({
  isOpen,
  onClose,
  message,
  editable = false,
}: MessageDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateQueuedMessage = useSessionMutation(api.messages.updateQueuedMessage);

  // Reset editing state whenever the modal opens or the message changes
  useEffect(() => {
    if (isOpen && message) {
      setEditedContent(message.content);
      setIsEditing(false);
      setSaveError(null);
    }
  }, [isOpen, message]);

  const handleCancel = useCallback(() => {
    setEditedContent(message?.content ?? '');
    setIsEditing(false);
    setSaveError(null);
  }, [message]);

  /** Escape / header close: leave edit mode first, then dismiss the modal. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      handleCancel();
      return;
    }
    onClose();
  }, [isEditing, handleCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (!message || !editedContent.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateQueuedMessage({
        queuedMessageId: message._id as Id<'chatroom_messageQueue'>,
        content: editedContent.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to update queued message';
      setSaveError(messageText);
      console.error('Failed to update queued message:', error);
    } finally {
      setIsSaving(false);
    }
  }, [message, editedContent, updateQueuedMessage]);

  if (!isOpen || !message) {
    return null;
  }

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
    <FixedModal
      isOpen
      onClose={dismissFromChrome}
      maxWidth="max-w-2xl"
      closeOnBackdrop={!isEditing}
    >
      <FixedModalContent>
        <FixedModalHeader onClose={dismissFromChrome}>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {classificationDisplay.icon}
            <span className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
              {isEditing ? 'Edit Message' : `${classificationDisplay.label} Details`}
            </span>
            {editable && !isEditing && (
              <button
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setIsEditing(true);
                }}
                className="ml-auto sm:ml-2 p-1.5 rounded border border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-accent"
                aria-label="Edit message"
                title="Edit"
              >
                <Pencil size={16} />
              </button>
            )}
          </div>
        </FixedModalHeader>

        <FixedModalBody>
          <div className="p-6 space-y-6">
            <div className="flex flex-wrap items-center gap-3 text-xs text-chatroom-text-muted pb-4 border-b border-chatroom-border">
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
              <span className="font-mono text-[10px]">{formatTime(message._creationTime)}</span>
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <textarea
                  value={editedContent}
                  onChange={(e) => {
                    setEditedContent(e.target.value);
                    if (saveError) setSaveError(null);
                  }}
                  className="w-full h-48 resize-none rounded border border-chatroom-border bg-chatroom-bg-secondary p-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:ring-2 focus:ring-chatroom-accent font-mono"
                  placeholder="Enter message content..."
                  autoFocus
                  aria-invalid={saveError ? true : undefined}
                  aria-describedby={saveError ? 'queued-message-save-error' : undefined}
                />
                {saveError ? (
                  <p
                    id="queued-message-save-error"
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    {saveError}
                  </p>
                ) : null}
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs border border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving || !editedContent.trim()}
                    className="px-3 py-1.5 text-xs bg-chatroom-accent text-chatroom-bg-primary hover:opacity-80 transition-opacity disabled:opacity-50 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chatroom-accent"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
            ) : isNewFeature ? (
              <>
                {message.featureTitle && (
                  <div>
                    <h2 className="text-lg font-bold text-chatroom-text-primary mb-2">
                      {message.featureTitle}
                    </h2>
                  </div>
                )}
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
                        {message.featureDescription}
                      </Markdown>
                    </div>
                  </div>
                )}
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
                        {message.featureTechSpecs}
                      </Markdown>
                    </div>
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare size={14} className="text-chatroom-text-muted" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                      Original Message
                    </span>
                  </div>
                  <div className={proseClassNames}>
                    <Markdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      components={fullMarkdownComponents}
                    >
                      {message.content}
                    </Markdown>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className="text-chatroom-text-muted" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                    Full Message
                  </span>
                </div>
                <div className={proseClassNames}>
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={fullMarkdownComponents}
                  >
                    {message.content}
                  </Markdown>
                </div>
              </div>
            )}
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
