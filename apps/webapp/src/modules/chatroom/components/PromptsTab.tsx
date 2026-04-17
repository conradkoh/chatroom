'use client';

/**
 * PromptsTab — Prompt override management for chatrooms.
 *
 * Allows users to override the default skill prompts with custom versions
 * tailored to specific projects.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Check,
  Edit,
  FileText,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Copy,
} from 'lucide-react';
import React, { useState, useCallback, memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

// ─── Types ──────────────────────────────────────────────────────────────

interface PromptsTabProps {
  chatroomId: string;
}

interface PromptItem {
  _id: Id<'chatroom_prompts'>;
  type: 'development_workflow';
  name: string;
  content: string;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Default Prompt Content ─────────────────────────────────────────────

const DEFAULT_DEVELOPMENT_WORKFLOW_CONTENT = `## Development & Release Flow

1. Check if there is an existing minor / patch release. Create a new release branch (e.g. \`release/1.0.1\`) if not yet available.
2. Update the versions in the package.json files in the repo (remember to check for monorepos with multiple packages)
3. Create a new PR from the release branch to the repo's default branch
4. Create a new feature branch from the release branch
5. Work on the feature and raise a PR to the release branch`;

// ─── Main Component ─────────────────────────────────────────────────────

export const PromptsTab = memo(function PromptsTab({ chatroomId }: PromptsTabProps) {
  const prompts = useSessionQuery(api.chatroomPrompts.getForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    type: 'development_workflow',
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-chatroom-text-muted">
            Override default skill prompts with custom versions for this chatroom.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="text-xs gap-1.5"
        >
          <Plus size={14} />
          Add Prompt
        </Button>
      </div>

      {/* Development Workflow Prompt */}
      {prompts ? (
        <PromptCard
          prompt={{
            _id: prompts._id as Id<'chatroom_prompts'>,
            type: 'development_workflow',
            name: prompts.name,
            content: prompts.content,
            isEnabled: prompts.isEnabled,
            createdAt: prompts.createdAt,
            updatedAt: prompts.updatedAt,
          }}
          onEdit={(prompt) => {
            setEditingPrompt(prompt);
            setShowEditDialog(true);
          }}
          onDelete={(promptId) => {
            setDeletingPromptId(promptId);
            setShowDeleteConfirm(true);
          }}
          onCopy={(prompt) => {
            setEditingPrompt(prompt);
            setShowCopyDialog(true);
          }}
        />
      ) : (
        <EmptyState onAdd={() => setShowCreateDialog(true)} />
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreatePromptDialog
          chatroomId={chatroomId}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {/* Edit Dialog */}
      {showEditDialog && editingPrompt && (
        <EditPromptDialog
          chatroomId={chatroomId}
          prompt={editingPrompt}
          onClose={() => {
            setShowEditDialog(false);
            setEditingPrompt(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && deletingPromptId && (
        <DeleteConfirmDialog
          chatroomId={chatroomId}
          promptId={deletingPromptId}
          onClose={() => {
            setShowDeleteConfirm(false);
            setDeletingPromptId(null);
          }}
        />
      )}
    </div>
  );
});

// ─── Empty State ────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-none bg-chatroom-bg-tertiary flex items-center justify-center mb-4">
        <FileText size={24} className="text-chatroom-text-muted" />
      </div>
      <h3 className="text-sm font-bold text-chatroom-text-primary mb-1">
        No prompts configured
      </h3>
      <p className="text-xs text-chatroom-text-muted mb-6 max-w-xs">
        Create a prompt override to customize agent behavior for this project.
      </p>
      <Button variant="outline" size="sm" onClick={onAdd} className="text-xs gap-1.5">
        <Plus size={14} />
        Add Prompt
      </Button>
    </div>
  );
});

// ─── Prompt Card ────────────────────────────────────────────────────────

const PromptCard = memo(function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onCopy,
}: {
  prompt: PromptItem;
  onEdit: (prompt: PromptItem) => void;
  onDelete: (promptId: string) => void;
  onCopy: (prompt: PromptItem) => void;
}) {
  const [isToggling, setIsToggling] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const toggle = useSessionMutation(api.chatroomPrompts.toggle);

  const handleToggle = useCallback(async () => {
    setIsToggling(true);
    try {
      await toggle({
        chatroomId: prompt._id.slice(0, 32) + '00000000000000000000000000', // placeholder
        chatroomId: prompt._id.slice(0, 32) + '00000000000000000000000000' as unknown as Id<'chatroom_rooms'>,
        promptId: prompt._id,
      });
    } finally {
      setIsToggling(false);
    }
  }, [prompt._id, toggle]);

  const handleDelete = useCallback(async () => {
    onDelete(prompt._id as string);
    setShowDeleteConfirm(false);
  }, [prompt._id, onDelete]);

  return (
    <div className="border border-chatroom-border rounded-none bg-chatroom-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-chatroom-border bg-chatroom-bg-tertiary/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-none bg-chatroom-bg-tertiary flex items-center justify-center">
            <FileText size={20} className="text-chatroom-text-muted" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-chatroom-text-primary">
                {prompt.name}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ${
                  prompt.isEnabled
                    ? 'bg-green-500/10 text-green-500 dark:bg-green-500/20 dark:text-green-400'
                    : 'bg-chatroom-bg-tertiary text-chatroom-text-muted'
                }`}
              >
                {prompt.isEnabled ? (
                  <>
                    <Power size={10} />
                    Active
                  </>
                ) : (
                  <>
                    <PowerOff size={10} />
                    Disabled
                  </>
                )}
              </span>
            </div>
            <span className="text-[11px] text-chatroom-text-muted font-mono">
              development_workflow
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Switch
            checked={prompt.isEnabled}
            onCheckedChange={handleToggle}
            disabled={isToggling}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopy(prompt)}
            className="text-chatroom-text-muted hover:text-chatroom-accent h-7 px-2 text-xs gap-1"
          >
            <Copy size={12} />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(prompt)}
            className="text-chatroom-text-muted hover:text-chatroom-accent h-7 px-2 text-xs gap-1"
          >
            <Edit size={12} />
            Edit
          </Button>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                className="text-xs h-7 px-2"
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                className="text-xs h-7 px-2"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-chatroom-text-muted hover:text-red-500 dark:hover:text-red-400 h-7 w-7 p-0"
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Content Preview */}
      <div className="p-4">
        <div className="text-xs text-chatroom-text-muted mb-2 font-bold uppercase tracking-widest">
          Content Preview
        </div>
        <pre className="text-xs text-chatroom-text-secondary bg-chatroom-bg-tertiary p-3 rounded border border-chatroom-border whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
          {prompt.content}
        </pre>
      </div>
    </div>
  );
});

// ─── Create Prompt Dialog ───────────────────────────────────────────────

const CreatePromptDialog = memo(function CreatePromptDialog({
  chatroomId,
  onClose,
}: {
  chatroomId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('Development Workflow');
  const [content, setContent] = useState(DEFAULT_DEVELOPMENT_WORKFLOW_CONTENT);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useSessionMutation(api.chatroomPrompts.create);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !content.trim()) {
      setError('Please enter a name and content');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await create({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        type: 'development_workflow',
        name: name.trim(),
        content: content.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? 'Failed to create prompt');
    } finally {
      setIsCreating(false);
    }
  }, [chatroomId, name, content, create, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Prompt Override</DialogTitle>
          <DialogDescription>
            Create a custom prompt to override the default skill prompt for this chatroom.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
              Prompt Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Development Workflow"
              className="text-sm bg-chatroom-bg-primary border-chatroom-border"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
              Prompt Content
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter your custom prompt content..."
              className="min-h-[300px] text-sm font-mono bg-chatroom-bg-primary border-chatroom-border resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !name.trim() || !content.trim()}
            className="text-xs gap-1.5"
          >
            {isCreating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check size={12} />
                Create Prompt
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ─── Edit Prompt Dialog ─────────────────────────────────────────────────

const EditPromptDialog = memo(function EditPromptDialog({
  chatroomId,
  prompt,
  onClose,
}: {
  chatroomId: string;
  prompt: PromptItem;
  onClose: () => void;
}) {
  const [name, setName] = useState(prompt.name);
  const [content, setContent] = useState(prompt.content);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useSessionMutation(api.chatroomPrompts.update);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !content.trim()) {
      setError('Please enter a name and content');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await update({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        promptId: prompt._id,
        name: name.trim(),
        content: content.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? 'Failed to update prompt');
    } finally {
      setIsSaving(false);
    }
  }, [chatroomId, prompt._id, name, content, update, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Prompt</DialogTitle>
          <DialogDescription>
            Update the name and content of this prompt override.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
              Prompt Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Development Workflow"
              className="text-sm bg-chatroom-bg-primary border-chatroom-border"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
              Prompt Content
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter your custom prompt content..."
              className="min-h-[300px] text-sm font-mono bg-chatroom-bg-primary border-chatroom-border resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !content.trim()}
            className="text-xs gap-1.5"
          >
            {isSaving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check size={12} />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ─── Delete Confirmation Dialog ────────────────────────────────────────

const DeleteConfirmDialog = memo(function DeleteConfirmDialog({
  chatroomId,
  promptId,
  onClose,
}: {
  chatroomId: string;
  promptId: string;
  onClose: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useSessionMutation(api.chatroomPrompts.remove);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await remove({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        promptId: promptId as Id<'chatroom_prompts'>,
      });
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? 'Failed to delete prompt');
    } finally {
      setIsDeleting(false);
    }
  }, [chatroomId, promptId, remove, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Prompt</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this prompt? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-xs">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-xs gap-1.5"
          >
            {isDeleting ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={12} />
                Delete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});