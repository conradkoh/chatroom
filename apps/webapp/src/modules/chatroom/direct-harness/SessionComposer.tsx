'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Send } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateSession } from './hooks/useCreateSession';
import { useSendMessage } from './hooks/useSendMessage';
import { useWorkspaceCapabilities } from './hooks/useWorkspaceCapabilities';
import {
  HarnessModelSelect,
  buildModelKey,
  parseModelKey,
} from './components/HarnessSelects';
import type { SessionStatus } from './StatusDot';

// ─── NewSessionComposer ───────────────────────────────────────────────────────

/**
 * Shown in the right pane when no session is selected.
 * Typing and sending creates a new session with the message as the first prompt.
 */
export function NewSessionComposer({
  workspaceId,
  onSessionCreated,
}: {
  workspaceId: Id<'chatroom_workspaces'>;
  onSessionCreated: (id: Id<'chatroom_harnessSessions'>) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [harnessName, setHarnessName] = useState('opencode-sdk');
  const [modelKey, setModelKey] = useState('');
  const { create, isCreating } = useCreateSession();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const capabilities = useWorkspaceCapabilities(workspaceId);

  const harnesses = capabilities?.harnesses ?? [];
  const selectedHarness = harnesses.find((h) => h.name === harnessName) ?? harnesses[0];
  const providers = selectedHarness?.providers ?? [];

  const trimmed = text.trim();
  const canSend = !!trimmed && !isCreating;

  const handleSend = async () => {
    if (!canSend) return;
    setError(null);
    const model = parseModelKey(modelKey);
    try {
      const result = await create({
        workspaceId,
        harnessName,
        config: {
          agent: 'build',
          ...(model ? { model } : {}),
        },
        firstMessage: trimmed,
      });
      onSessionCreated(result.harnessSessionId);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
        <p className="text-sm font-medium text-foreground">New session</p>
        <p className="text-xs">Type a message below to get started.</p>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-3 flex flex-col gap-2">
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {/* Textarea + send button */}
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            rows={3}
            className="flex-1 resize-none text-sm"
            placeholder="Message… (Enter to send, Shift+Enter for new line)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCreating}
            autoFocus
          />
          <Button
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={!canSend}
            onClick={() => void handleSend()}
          >
            <Send size={15} />
          </Button>
        </div>

        {/* Harness + model selectors */}
        <div className="flex gap-2">
          {/* Harness selector */}
          <Select value={harnessName} onValueChange={setHarnessName}>
            <SelectTrigger className="h-7 py-0 text-xs w-36 shrink-0">
              <SelectValue placeholder="Harness" />
            </SelectTrigger>
            <SelectContent>
              {harnesses.length > 0 ? (
                harnesses.map((h) => (
                  <SelectItem key={h.name} value={h.name} className="text-xs">
                    {h.displayName}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="opencode-sdk" className="text-xs">
                  Opencode
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          {/* Model selector — grouped by provider, searchable */}
          <div className="flex-1 min-w-0 flex flex-col">
            <HarnessModelSelect
              providers={providers}
              value={modelKey}
              onValueChange={setModelKey}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SessionComposer ──────────────────────────────────────────────────────────

/**
 * Shown at the bottom of an active session for follow-up messages.
 */
export function SessionComposer({
  sessionRowId,
  status,
}: {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  status: SessionStatus;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { send, isSending } = useSendMessage();

  const isTerminal = status === 'closed' || status === 'failed';
  const isDisabled = status === 'pending' || status === 'spawning' || isTerminal || isSending;
  const trimmed = text.trim();
  const canSend = !!trimmed && !isDisabled;

  const handleSend = async () => {
    if (!canSend) return;
    setError(null);
    try {
      await send({ harnessSessionId: sessionRowId, text: trimmed });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (isTerminal) {
    return (
      <div className="shrink-0 border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          This session is {status}. Start a new session to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border p-3 flex flex-col gap-2">
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2 items-end">
        <Textarea
          rows={3}
          className="flex-1 resize-none text-sm"
          placeholder="Message… (Enter to send, Shift+Enter for new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
        />
        <Button
          size="icon"
          className="shrink-0 h-9 w-9"
          disabled={!canSend}
          onClick={() => void handleSend()}
        >
          <Send size={15} />
        </Button>
      </div>
    </div>
  );
}
