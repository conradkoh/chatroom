'use client';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

export function QueuedMessageNewSessionToggle({
  queuedMessageId,
  startInNewSession = false,
}: {
  queuedMessageId: string;
  startInNewSession?: boolean;
}) {
  const update = useSessionMutation(api.messages.updateQueuedMessageStartInNewSession);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-testid="queued-message-new-session-toggle"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await update({
            queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
            startInNewSession: !startInNewSession,
          });
        } finally {
          setBusy(false);
        }
      }}
      className={
        startInNewSession
          ? 'p-1.5 text-yellow-500 dark:text-yellow-400'
          : 'p-1.5 text-muted-foreground'
      }
    >
      <RotateCcw size={14} />
    </button>
  );
}
