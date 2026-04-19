'use client';

/**
 * SkillEditorModal — Textarea editor with read-only toggle for editing skill customization content.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Eye, Pencil, Loader2 } from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// ─── Types ──────────────────────────────────────────────────────────────

interface SkillEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  customizationId: string;
  initialContent: string;
  skillName: string;
}

// ─── Main Component ─────────────────────────────────────────────────────

export const SkillEditorModal = memo(function SkillEditorModal({
  isOpen,
  onClose,
  chatroomId,
  customizationId,
  initialContent,
  skillName,
}: SkillEditorModalProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<'edit' | 'readonly'>('edit');
  const [isSaving, setIsSaving] = useState(false);

  const updateCustomization = useSessionMutation(api.chatroomSkillCustomizations.update);

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
      await updateCustomization({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        customizationId: customizationId as Id<'chatroom_skillCustomizations'>,
        content,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save skill customization:', error);
      toast.error('Failed to save skill customization. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [updateCustomization, chatroomId, customizationId, content, onClose]);

  const handleCancel = useCallback(() => {
    setContent(initialContent);
    onClose();
  }, [initialContent, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground">Customize Skill: {skillName}</DialogTitle>
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
            onClick={() => setMode('readonly')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'readonly'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="h-3 w-3" />
            Read-only
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'edit' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-[50vh] w-full resize-none rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter your skill customization content here..."
              spellCheck={false}
            />
          ) : (
            <div className="h-[50vh] overflow-auto rounded-md border border-border bg-card p-3">
              <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                {content || <span className="text-muted-foreground italic">No content</span>}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || content.trim().length === 0}>
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
