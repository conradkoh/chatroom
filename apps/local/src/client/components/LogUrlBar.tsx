import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export function LogUrlBar({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const primary = urls[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (!primary) return null;

  return (
    <div
      ref={containerRef}
      className="relative flex shrink-0 items-center gap-2 border-b-2 border-chatroom-border bg-chatroom-bg-secondary px-4 py-2"
    >
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
        URL
      </span>
      <a
        href={primary}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-xs text-chatroom-status-info underline hover:opacity-80"
        title={primary}
      >
        {primary}
      </a>
      {urls.length > 1 && (
        <div className="relative shrink-0">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 border-2 border-chatroom-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-chatroom-text-muted transition-colors hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            All ({urls.length})
            <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div
              className="absolute right-0 top-full z-20 mt-1 max-h-48 w-max min-w-[16rem] max-w-[32rem] overflow-y-auto border-2 border-chatroom-border-strong bg-chatroom-bg-tertiary shadow-lg"
              role="listbox"
              aria-label="Detected URLs"
            >
              {urls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'block truncate px-3 py-2 font-mono text-xs text-chatroom-status-info underline hover:bg-chatroom-bg-hover',
                    url === primary && 'bg-chatroom-bg-hover'
                  )}
                  title={url}
                  role="option"
                  onClick={() => setOpen(false)}
                >
                  {url}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
