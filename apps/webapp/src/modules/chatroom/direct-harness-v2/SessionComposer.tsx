'use client';

import { useState } from 'react';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { SessionStatus } from './StatusDot';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionComposerProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  status: SessionStatus;
}

// ─── SessionComposer ──────────────────────────────────────────────────────────

export function SessionComposer({ sessionRowId, status }: SessionComposerProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPrompt = useSessionMutation(api.chatroom.directHarness.prompts.submitPrompt);

  const isTerminal = status === 'closed' || status === 'failed';
  const isInputDisabled =
    status === 'pending' || status === 'spawning' || status === 'closed' || status === 'failed';
  const trimmed = text.trim();
  const isSendDisabled = !trimmed || isInputDisabled || isSending;

  const handleSend = async () => {
    if (isSendDisabled) return;
    const toSend = trimmed;
    setIsSending(true);
    setError(null);
    try {
      await submitPrompt({
        harnessSessionRowId: sessionRowId,
        parts: [{ type: 'text', text: toSend }],
      });
      setText('');
    } catch (err) {
      console.error('Failed to send prompt:', err);
      setError(err instanceof Error ? err.message : 'Failed to send prompt.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isTerminal) {
    return (
      <div className="shrink-0 border-t border-border p-2">
        <p className="text-xs text-muted-foreground">
          Session is {status}. Open a new session to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border p-2 flex flex-col gap-1.5">
      <Textarea
        rows={2}
        className="resize-none text-sm"
        placeholder="Send a prompt…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isInputDisabled}
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={isSendDisabled}
          onClick={handleSend}
          className="gap-1.5"
        >
          <Send size={14} />
          Send
        </Button>
      </div>
    </div>
  );
}
