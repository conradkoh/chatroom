import { ScrollText } from 'lucide-react';

export function LogsPage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="flex size-16 items-center justify-center border border-chatroom-border bg-chatroom-bg-secondary">
        <ScrollText className="size-8 text-chatroom-text-muted" aria-hidden />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-medium tracking-tight">Logs</h2>
        <p className="mt-2 max-w-sm text-sm text-chatroom-text-muted">Coming soon</p>
      </div>
    </section>
  );
}
