import { LogLoadingSkeleton } from '@/components/logs/LogLoadingSkeleton';
import type { EventStreamEntry } from '@/api/types';
import { EventStreamEmptyState } from './EventStreamEmptyState';

export function EventStreamViewer({ entries, isLoading, error, hasChatroom }: { entries: EventStreamEntry[]; isLoading: boolean; error: string | null; hasChatroom: boolean }) {
  if (isLoading) return <div className="min-h-[400px] flex-1 border border-chatroom-border bg-chatroom-bg-secondary"><LogLoadingSkeleton /></div>;
  if (error) return <div className="flex min-h-[400px] flex-1 items-center border border-chatroom-border bg-chatroom-bg-secondary p-4 text-chatroom-status-error">{error}</div>;
  if (!hasChatroom || entries.length === 0) return <EventStreamEmptyState hasChatroom={hasChatroom} />;
  return <div className="min-h-[400px] flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-secondary font-mono text-xs"><table className="w-full border-collapse"><thead className="sticky top-0 bg-chatroom-bg-primary text-left text-chatroom-text-muted"><tr><th className="border-b border-chatroom-border px-3 py-2 font-medium">Time</th><th className="border-b border-chatroom-border px-3 py-2 font-medium">Type</th><th className="border-b border-chatroom-border px-3 py-2 font-medium">Payload</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-chatroom-border align-top"><td className="whitespace-nowrap px-3 py-2 text-chatroom-text-muted">{new Date(entry.timestamp).toISOString()}</td><td className="whitespace-nowrap px-3 py-2 text-chatroom-text-primary">{entry.type}</td><td className="whitespace-pre-wrap break-all px-3 py-2 text-chatroom-text-secondary">{JSON.stringify(entry.payload, null, 2)}</td></tr>)}</tbody></table></div>;
}
