'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { AlertTriangle, ArrowUp, Code2, X } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';

import {
  AttachedBacklogItemChip,
  AttachedMessageChip,
  AttachedSnippetChip,
  AttachedTaskChip,
  buildExplorerSelectionPrefill,
  renderInlineReference,
  subscribeComposerPrefill,
  subscribeComposerTextPrefill,
  useAttachments,
  useBacklogAttachments,
  useMessageAttachments,
  useSnippetAttachments,
  useTaskAttachments,
} from '../attachments';
import { EditorModal } from './EditorModal';
import { FileReferenceAutocomplete } from './FileReferenceAutocomplete';
import type { FileEntry } from './FileSelector/useFileSelector';
import {
  getEffectiveMaxTextareaHeightPx,
  getViewportHeightPx,
  MAX_TEXTAREA_HEIGHT_PX,
  measureTextareaContentHeightPx,
} from './messageInputAutosize';
import { useFileReferenceAutocomplete } from '../hooks/useFileReferenceAutocomplete';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MessageInputProps {
  chatroomId: string;
  onBeforeResize?: () => void;
  onAfterResize?: () => void;
  onRegisterFocus?: (focusFn: () => void) => void;
  /** Available workspace files for @ autocomplete (tagged with workspaceId) */
  files?: FileEntry[];
  /** Whether at least one workspace is registered for @ autocomplete. */
  hasAutocompleteWorkspace?: boolean;
  /** Refreshes autocomplete files when the @ trigger opens. */
  onAtTriggerActivate?: () => void;
}

// ── Touch detection ──────────────────────────────────────────────────────────

function useIsTouchDevice(): boolean | undefined {
  const [mounted, setMounted] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setMounted(true);
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    setIsTouch(isTouchDevice);
  }, []);

  return mounted ? isTouch : undefined;
}

// ── Draft storage helpers ────────────────────────────────────────────────────

const DRAFT_KEY_PREFIX = 'chatroom-draft:';
const MAX_DRAFTS = 10;

function useEffectiveMaxTextareaHeightPx(): number {
  const [maxHeightPx, setMaxHeightPx] = useState(MAX_TEXTAREA_HEIGHT_PX);

  useEffect(() => {
    const update = () => {
      const viewportHeight = getViewportHeightPx(window.visualViewport?.height, window.innerHeight);
      setMaxHeightPx(getEffectiveMaxTextareaHeightPx(viewportHeight));
    };

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return maxHeightPx;
}

interface StoredDraft {
  content: string;
  updatedAt: number;
}

function parseDraft(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed && typeof parsed.content === 'string') return parsed.content;
  } catch {
    return raw;
  }
  return raw;
}

function saveDraft(key: string, content: string) {
  const draft: StoredDraft = { content, updatedAt: Date.now() };
  localStorage.setItem(key, JSON.stringify(draft));
  cleanupOldDrafts(key);
}

function cleanupOldDrafts(currentKey: string) {
  const entries: { key: string; updatedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let updatedAt = 0;
    try {
      const parsed = JSON.parse(raw) as StoredDraft;
      if (parsed && typeof parsed.updatedAt === 'number') updatedAt = parsed.updatedAt;
    } catch {
      // Legacy string — treat as oldest
    }
    entries.push({ key, updatedAt });
  }
  if (entries.length <= MAX_DRAFTS) return;
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const entry of entries.slice(MAX_DRAFTS)) {
    if (entry.key !== currentKey) localStorage.removeItem(entry.key);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function MessageInput({
  chatroomId,
  onBeforeResize,
  onAfterResize,
  onRegisterFocus,
  files = [],
  hasAutocompleteWorkspace = false,
  onAtTriggerActivate,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const snippetRefsRef = useRef<string[]>([]);
  const isTouchDevice = useIsTouchDevice();
  const effectiveMaxTextareaHeightPx = useEffectiveMaxTextareaHeightPx();

  const [editorOpen, setEditorOpen] = useState(false);

  // Register focus callback for external callers
  useEffect(() => {
    onRegisterFocus?.(() => {
      textareaRef.current?.focus();
    });
  }, [onRegisterFocus]);

  // Prefill from explorer Cmd+I selection
  const { add, remove, clearAll } = useAttachments();
  const snippetAttachments = useSnippetAttachments();

  useEffect(() => {
    snippetRefsRef.current = snippetAttachments.map((s) => s.id);
  }, [snippetAttachments]);

  useEffect(() => {
    return subscribeComposerPrefill((detail) => {
      const { attachment, messageBody } = buildExplorerSelectionPrefill(
        detail.fileSource,
        detail.selectedContent,
        snippetRefsRef.current
      );
      add({
        type: 'snippet',
        id: attachment.reference,
        fileSource: attachment.fileSource,
        selectedContent: attachment.selectedContent,
      });
      setMessage((prev) => (prev.trim() ? `${prev}\n${messageBody}` : messageBody));
      setTimeout(() => textareaRef.current?.focus(), 0);
    });
  }, [add]);

  useEffect(() => {
    return subscribeComposerTextPrefill((detail) => {
      setMessage(detail.content);
      setSendError(null);
      setTimeout(() => textareaRef.current?.focus(), 0);
    });
  }, []);

  // ── Draft persistence ──────────────────────────────────────────────────────
  const draftKey = `chatroom-draft:${chatroomId}`;

  // Restore draft on mount (once per chatroomId) and auto-focus
  useEffect(() => {
    const saved = parseDraft(localStorage.getItem(draftKey));
    if (saved) setMessage(saved);
    // Auto-focus when switching chatrooms (non-touch devices only)
    if (!isTouchDevice) {
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatroomId]);

  // Debounced save: write 500ms after the last keystroke, clear when empty
  useEffect(() => {
    const timer = setTimeout(() => {
      if (message) {
        saveDraft(draftKey, message);
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [message, draftKey]);

  // ── Attachments context ────────────────────────────────────────────────────
  const attachedTasks = useTaskAttachments();
  const attachedBacklogItems = useBacklogAttachments();
  const attachedMessages = useMessageAttachments();

  const sendMessage = useSessionMutation(api.messages.sendMessage);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    onBeforeResize?.();
    const nextHeight = measureTextareaContentHeightPx(textarea, effectiveMaxTextareaHeightPx);
    textarea.style.height = `${nextHeight}px`;
    onAfterResize?.();
  }, [onBeforeResize, onAfterResize, effectiveMaxTextareaHeightPx]);

  // Re-measure when the composer width changes (e.g. explorer split panel resize).
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => autoResize());
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [autoResize]);

  // ── Shared @ file reference autocomplete (after autoResize is defined) ──────
  const fileAutocomplete = useFileReferenceAutocomplete({
    files,
    hasWorkspace: hasAutocompleteWorkspace,
    onAtTriggerActivate,
    textareaRef,
    anchorRef: formContainerRef,
    text: message,
    onTextChange: (v) => {
      setMessage(v);
      setSendError(null);
    },
    onAfterUpdate: autoResize,
  });

  // Re-measure textarea height whenever message changes (covers draft restore,
  // editor modal close, and autocomplete file select uniformly)
  useEffect(() => {
    autoResize();
  }, [message, autoResize, effectiveMaxTextareaHeightPx]);

  // ── Send logic ─────────────────────────────────────────────────────────────
  const doSend = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      setSending(true);
      try {
        const snippets = snippetAttachments.map((s) => ({
          reference: s.id,
          fileSource: s.fileSource,
          selectedContent: s.selectedContent,
        }));

        await sendMessage({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          senderRole: 'user',
          content: text.trim(),
          type: 'message',
          ...(snippets.length > 0 && { attachedSnippets: snippets }),
          ...(attachedTasks.length > 0 && {
            attachedTaskIds: attachedTasks.map((task) => task.id),
          }),
          ...(attachedBacklogItems.length > 0 && {
            attachedBacklogItemIds: attachedBacklogItems.map((item) => item.id),
          }),
          ...(attachedMessages.length > 0 && {
            attachedMessageIds: attachedMessages.map((msg) => msg.id),
          }),
        });
        setMessage('');
        setSendError(null);
        localStorage.removeItem(draftKey);
        if (
          attachedTasks.length > 0 ||
          attachedBacklogItems.length > 0 ||
          attachedMessages.length > 0 ||
          snippetAttachments.length > 0
        ) {
          clearAll();
        }
        // Reset textarea height
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        setTimeout(() => textareaRef.current?.focus(), 0);
      } catch (error) {
        console.error('Failed to send message:', error);
        setSendError(
          error instanceof Error && error.message
            ? `Failed to send: ${error.message}`
            : 'Failed to send message. Please try again.'
        );
      } finally {
        setSending(false);
      }
    },
    [
      sending,
      sendMessage,
      chatroomId,
      attachedTasks,
      attachedBacklogItems,
      attachedMessages,
      snippetAttachments,
      clearAll,
      draftKey,
    ]
  );

  const handleSubmit = useCallback(async () => {
    await doSend(message);
  }, [doSend, message]);

  // ── Input handlers ─────────────────────────────────────────────────────────
  const handleChange = fileAutocomplete.handleTextareaChange;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (fileAutocomplete.handleAutocompleteKeyDown(e)) return;
      if (isTouchDevice) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [fileAutocomplete, handleSubmit, isTouchDevice]
  );

  const handleFileSelect = fileAutocomplete.handleFileSelect;

  // ── Editor modal callbacks ─────────────────────────────────────────────────
  const handleEditorClose = useCallback((editedText: string) => {
    setMessage(editedText);
    setEditorOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleEditorSend = useCallback(
    async (text: string) => {
      setMessage(text);
      setEditorOpen(false);
      await doSend(text);
    },
    [doSend]
  );

  // ── Send button click ──────────────────────────────────────────────────────
  const handleSendClick = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  const hasAttachments =
    attachedTasks.length > 0 ||
    attachedBacklogItems.length > 0 ||
    attachedMessages.length > 0 ||
    snippetAttachments.length > 0;

  const handleRemoveSnippet = useCallback(
    (reference: string) => {
      remove('snippet', reference);
      setMessage((t) =>
        t.replace(renderInlineReference(reference), '').replace(/\n\n+/g, '\n').trim()
      );
    },
    [remove]
  );

  const canSend = message.trim().length > 0 && !sending;

  return (
    <div ref={formContainerRef} className="relative bg-chatroom-bg-surface backdrop-blur-xl">
      {/* @ file reference autocomplete dropdown */}
      <FileReferenceAutocomplete
        results={fileAutocomplete.autocompleteState.results}
        selectedIndex={fileAutocomplete.autocompleteState.selectedIndex}
        position={fileAutocomplete.autocompleteState.position}
        onSelect={handleFileSelect}
        onHoverItem={fileAutocomplete.setSelectedIndex}
        visible={fileAutocomplete.autocompleteState.visible}
      />

      {/* Attachment chips row */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-0.5">
          {attachedTasks.map((task) => (
            <AttachedTaskChip
              key={task.id}
              mode="editable"
              taskId={task.id}
              content={task.content}
              onRemove={() => remove('task', task.id)}
            />
          ))}
          {attachedBacklogItems.map((item) => (
            <AttachedBacklogItemChip
              key={item.id}
              mode="editable"
              itemId={item.id}
              content={item.content}
              onRemove={() => remove('backlog', item.id)}
            />
          ))}
          {attachedMessages.map((msg) => (
            <AttachedMessageChip
              key={msg.id}
              mode="editable"
              messageId={msg.id}
              content={msg.content}
              senderRole={msg.senderRole}
              onRemove={() => remove('message', msg.id)}
            />
          ))}
          {snippetAttachments.map((s) => (
            <AttachedSnippetChip
              key={s.id}
              mode="editable"
              reference={s.id}
              fileSource={s.fileSource}
              selectedContent={s.selectedContent}
              onRemove={() => handleRemoveSnippet(s.id)}
            />
          ))}
        </div>
      )}

      {/* Inline send-error banner */}
      {sendError && (
        <div
          role="alert"
          className="mx-2 mt-1.5 flex items-start gap-1.5 px-2 py-1.5 border-2 border-chatroom-status-error/40 bg-chatroom-status-error/10"
        >
          <AlertTriangle
            size={14}
            className="flex-shrink-0 mt-0.5 text-chatroom-status-error"
            aria-hidden
          />
          <p className="flex-1 text-xs text-chatroom-status-error break-words">{sendError}</p>
          <button
            type="button"
            onClick={() => setSendError(null)}
            className="flex-shrink-0 text-chatroom-status-error/60 hover:text-chatroom-status-error"
            aria-label="Dismiss send error"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 w-full">
        {/* Textarea wrapper: border + flex-1 min-w-0 */}
        <div className="flex-1 min-w-0 rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary overflow-hidden">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={sending}
            rows={1}
            className="block w-full self-start bg-transparent border-none outline-none text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted px-2 py-1.5 resize-none overflow-y-auto"
            style={{ maxHeight: `${effectiveMaxTextareaHeightPx}px` }}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Editor modal button (desktop only) */}
          {!isTouchDevice && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              title="Open editor"
              className="p-1.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
            >
              <Code2 size={16} />
            </button>
          )}

          {/* Send button: icon-only, circular */}
          <button
            type="button"
            onClick={handleSendClick}
            disabled={!canSend}
            onMouseDown={(e) => {
              // Prevent focus from leaving the textarea on click
              e.preventDefault();
            }}
            className="rounded-none w-8 h-8 flex-shrink-0 flex items-center justify-center transition-all duration-100 bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>

      {/* Editor Modal */}
      <EditorModal
        isOpen={editorOpen}
        initialValue={message}
        onClose={handleEditorClose}
        onSend={handleEditorSend}
      />
    </div>
  );
}
