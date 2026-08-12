import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type Props = { isLoading: boolean; isError: boolean; port?: number; service?: string };
export function ConnectionStatus({ isLoading, isError, port, service }: Props) {
  if (isLoading)
    return (
      <div className="flex min-w-[10rem] items-center gap-2" aria-live="polite">
        <Skeleton className="h-5 w-20" />
        <span className="text-xs text-chatroom-text-muted">Connecting…</span>
      </div>
    );
  if (isError)
    return (
      <Badge variant="destructive" aria-live="polite">
        Disconnected
      </Badge>
    );
  return (
    <div className="flex items-center gap-2 text-xs text-chatroom-text-muted" aria-live="polite">
      <Badge
        variant="outline"
        className="border-chatroom-status-success text-chatroom-status-success"
      >
        Connected
      </Badge>
      {port != null && service != null && (
        <span>
          Port {port} · {service}
        </span>
      )}
    </div>
  );
}
