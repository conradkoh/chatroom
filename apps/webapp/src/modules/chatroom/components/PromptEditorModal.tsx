'use client';

/**
 * PromptEditorModal — Textarea editor with preview toggle for editing prompt content.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Eye, Pencil, Loader2 } from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── Types ──────────────────────────────────────────────────────────────

interface PromptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  promptId: string;
  initialContent: string;
  promptName: string;
}

// ─── Main Component ─────────────────────────────────────────────────────

export const PromptEditorModal = memo(function PromptEditorModal({
  isOpen,
  onClose,
  chatroomId,
  promptId,
  initialContent,
  promptName,
}: PromptEditorModalProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isSaving, setIsSaving] = useState(false);

  const updatePrompt = useSessionMutation(api.chatroomPrompts.update);

  // Reset content when modal opens with new content
  React.useEffect(() => {
    if (isOpen) {
      setContent(initialContent);
      setMode('edit');
    }
  }, [isOpen, initialContent]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updatePrompt({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        promptId: promptId as Id<'chatroom_prompts'>,
        content,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [updatePrompt, chatroomId, promptId, content, onClose]);

  const handleCancel = useCallback(() => {
    setContent(initialContent);
    onClose();
  }, [initialContent, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground">{promptName}</DialogTitle>
        </DialogHeader>

        {/* Mode Toggle */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'edit'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'preview'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'edit' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-[50vh] w-full resize-none rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter your prompt content here..."
              spellCheck={false}
            />
          ) : (
            <div className="h-[50vh] overflow-auto rounded-md border border-border bg-card p-3">
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-sm text-foreground">
                {content || (
                  <span className="text-muted-foreground italic">No content</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
