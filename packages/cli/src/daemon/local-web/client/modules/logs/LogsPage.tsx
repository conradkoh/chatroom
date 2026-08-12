import { useEffect, useRef, useState } from 'react';
import { useDaemonLogs } from '@/hooks/use-daemon-logs';

export function LogsPage() {
  const [source, setSource] = useState<string>();
  const { lines, sources, isLoading, error } = useDaemonLogs(source);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [lines.length]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex items-center justify-between"><h2 className="text-lg font-medium">Logs</h2><select className="border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1 text-xs" value={source ?? ''} onChange={(e) => setSource(e.target.value || undefined)}><option value="">All sources</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      {isLoading && <p className="text-sm text-chatroom-text-muted">Loading logs…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!isLoading && !error && <div className="min-h-0 flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-secondary p-3 font-mono text-xs">{lines.length === 0 ? <p className="text-chatroom-text-muted">No logs yet — start an agent session</p> : lines.map((line, index) => <div key={line.id ?? `${line.timestamp}-${index}`} className="flex gap-3 whitespace-pre-wrap py-1"><span className="text-chatroom-text-muted">{new Date(line.timestamp).toISOString().slice(11, 19)}</span><span className={line.level === 'error' ? 'text-red-400' : line.level === 'warn' ? 'text-yellow-400' : 'text-chatroom-text-muted'}>{line.level}</span><span className="text-chatroom-text-muted">{line.source}</span><span>{line.message}</span></div>)}<div ref={bottom} /></div>}
    </section>
  );
}
