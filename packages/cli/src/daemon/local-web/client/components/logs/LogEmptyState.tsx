import { ScrollText } from 'lucide-react';

export function LogEmptyState({ hasChatroom }: { hasChatroom: boolean }) {
  return (
    <div
      className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-2 border border-chatroom-border bg-chatroom-bg-secondary p-6 text-center"
      role="status"
    >
      <ScrollText className="size-8 text-chatroom-text-muted" aria-hidden />
      <p className="text-sm text-chatroom-text-secondary">
        {hasChatroom ? 'No logs in this time range' : 'Select a chatroom to view logs'}
      </p>
      {hasChatroom && (
        <p className="text-xs text-chatroom-text-muted">
          Start an agent session to see output here
        </p>
      )}
    </div>
  );
}
