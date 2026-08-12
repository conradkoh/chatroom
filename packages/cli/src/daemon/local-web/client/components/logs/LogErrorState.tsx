import { AlertCircle } from 'lucide-react';

export function LogErrorState({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-2 border border-chatroom-status-error/30 bg-chatroom-bg-secondary p-6 text-center"
      role="alert"
    >
      <AlertCircle className="size-8 text-chatroom-status-error" aria-hidden />
      <p className="text-sm text-chatroom-status-error">Failed to load logs</p>
      <p className="text-xs text-chatroom-text-muted">{message}</p>
    </div>
  );
}
