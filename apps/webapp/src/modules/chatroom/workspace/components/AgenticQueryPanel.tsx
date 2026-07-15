'use client';

import { Search, HelpCircle } from 'lucide-react';
import { useState } from 'react';

import type { AgenticQueryMode } from '../hooks/useFileTabs';

import { cn } from '@/lib/utils';

export interface AgenticQueryPanelProps {
  queryId: string;
  mode: AgenticQueryMode;
}

export function AgenticQueryPanel({
  queryId: _queryId,
  mode: initialMode,
}: AgenticQueryPanelProps) {
  const [mode, setMode] = useState<AgenticQueryMode>(initialMode);
  const [queryText, setQueryText] = useState('');

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setMode('search')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors',
            mode === 'search'
              ? 'bg-chatroom-accent text-white'
              : 'bg-chatroom-bg-tertiary text-chatroom-text-muted hover:text-chatroom-text-primary'
          )}
        >
          <Search size={12} />
          Search
        </button>
        <button
          type="button"
          onClick={() => setMode('ask')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors',
            mode === 'ask'
              ? 'bg-chatroom-accent text-white'
              : 'bg-chatroom-bg-tertiary text-chatroom-text-muted hover:text-chatroom-text-primary'
          )}
        >
          <HelpCircle size={12} />
          Ask
        </button>
      </div>

      {/* Query textarea */}
      <textarea
        value={queryText}
        onChange={(e) => setQueryText(e.target.value)}
        placeholder={
          mode === 'search'
            ? 'Search the codebase… (e.g. "find all WebSocket connection handlers")'
            : 'Ask a question about the codebase… (e.g. "how does authentication work?")'
        }
        className="flex-1 min-h-0 w-full resize-none bg-chatroom-bg-tertiary border border-chatroom-border p-3 text-[13px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none focus:border-chatroom-accent font-mono"
      />

      {/* Submit button (disabled — coming in slice 1) */}
      <button
        type="button"
        disabled
        title="Coming soon"
        className="w-full shrink-0 bg-chatroom-accent/50 text-white text-[10px] font-bold uppercase tracking-wider py-2 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Submit
      </button>

      {/* Placeholder thread area */}
      <div className="flex-1 flex items-center justify-center border border-dashed border-chatroom-border rounded-sm">
        <span className="text-xs text-chatroom-text-muted">
          Type a query and submit to get started
        </span>
      </div>
    </div>
  );
}
