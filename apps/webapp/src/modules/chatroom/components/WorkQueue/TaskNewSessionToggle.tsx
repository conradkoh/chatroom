'use client';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

export function TaskNewSessionToggle({
  taskId,
  status,
  startInNewSession = false,
}: {
  taskId: string;
  status: string;
  startInNewSession?: boolean;
}) {
  const update = useSessionMutation(api.tasks.updateTaskStartInNewSession);
  const [busy, setBusy] = useState(false);
  if (status !== 'pending') return null;
  return (
    <button
      type="button"
      data-testid="task-new-session-toggle"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await update({
            taskId: taskId as Id<'chatroom_tasks'>,
            startInNewSession: !startInNewSession,
          });
        } finally {
          setBusy(false);
        }
      }}
      className={startInNewSession ? 'p-1.5 text-yellow-500 dark:text-yellow-400' : 'p-1.5 text-muted-foreground'}
    >
      <RotateCcw size={14} />
    </button>
  );
}
