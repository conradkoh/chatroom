'use client';

// fallow-ignore-file complexity

import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';

import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import {
  DetailModalMarkdownSurface,
  detailModalRichTextEditorProseClassNames,
} from '../../components/detail-modal';
import {
  RichTextEditor,
  createDetailModalEditSurfaceProps,
} from '../../components/detail-modal-shared';
import { modalMarkdownComponents } from '../../components/markdown-utils';

import { reserializeMarkdownBlankLines } from '@/components/markdown-editor/utils/reserializeMarkdownBlankLines';
import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

type AttachmentMarkdownModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  content: string;
  proseClassName: string;
  /** When true, body is click-to-edit with Save/Cancel footer. */
  editable?: boolean;
  /** Called on Save with reserialized content. May be async. */
  onSave?: (content: string) => void | Promise<void>;
};

/** Shared markdown preview modal for task/backlog/message attachment chips. */
export function AttachmentMarkdownModal({
  isOpen,
  onClose,
  title,
  icon,
  content,
  proseClassName,
  editable = false,
  onSave,
}: AttachmentMarkdownModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [initialClickCoords, setInitialClickCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditedContent(content);
      setIsEditing(false);
      setInitialClickCoords(null);
      setIsSaving(false);
    }
  }, [isOpen, content]);

  const cancelEdit = useCallback(() => {
    setEditedContent(content);
    setIsEditing(false);
    setInitialClickCoords(null);
  }, [content]);

  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      cancelEdit();
    } else {
      onClose();
    }
  }, [isEditing, cancelEdit, onClose]);

  const enterEdit = useCallback((coords?: { left: number; top: number } | null) => {
    setInitialClickCoords(coords ?? null);
    setIsEditing(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editedContent.trim() || !onSave) return;
    setIsSaving(true);
    try {
      const serialized = reserializeMarkdownBlankLines(editedContent);
      await onSave(serialized);
      setIsEditing(false);
      setInitialClickCoords(null);
    } catch (error) {
      console.error('Failed to save attachment content:', error);
    } finally {
      setIsSaving(false);
    }
  }, [editedContent, isSaving, onSave]);

  return (
    <FixedModal
      isOpen={isOpen}
      onClose={dismissFromChrome}
      maxWidth="max-w-2xl"
      closeOnBackdrop={editable ? !isEditing : true}
    >
      <FixedModalContent>
        <FixedModalHeader onClose={dismissFromChrome}>
          <div className="flex items-center gap-2">
            {icon}
            <FixedModalTitle>{title}</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <FixedModalBody className={editable ? 'flex flex-col min-h-0 p-0' : undefined}>
          {editable && isEditing ? (
            <RichTextEditor
              value={editedContent}
              onChange={setEditedContent}
              placeholder="Write your markdown here..."
              onCmdEnter={handleSave}
              initialClickCoords={initialClickCoords}
              className="flex-1 flex flex-col min-h-0"
              proseClassName={detailModalRichTextEditorProseClassNames}
            />
          ) : editable ? (
            <DetailModalMarkdownSurface
              data-testid="attachment-markdown-view-body"
              {...createDetailModalEditSurfaceProps(enterEdit)}
              proseClassName={proseClassName}
            >
              <Markdown remarkPlugins={chatroomRemarkPlugins} components={modalMarkdownComponents}>
                {content}
              </Markdown>
            </DetailModalMarkdownSurface>
          ) : (
            <div className={`p-4 min-w-0 overflow-x-hidden ${proseClassName}`}>
              <Markdown remarkPlugins={chatroomRemarkPlugins} components={modalMarkdownComponents}>
                {content}
              </Markdown>
            </div>
          )}
        </FixedModalBody>

        {editable && (
          <div className="border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 p-4 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !editedContent.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-transparent bg-chatroom-accent text-chatroom-bg-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check size={12} />
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X size={12} />
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => enterEdit(null)}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-all duration-100"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </FixedModalContent>
    </FixedModal>
  );
}
