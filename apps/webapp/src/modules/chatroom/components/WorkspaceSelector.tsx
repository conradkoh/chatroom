'use client';

import { Search, X } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';

import { getWorkspaceDisplayHostname } from '../types/workspace';
import { formatRelativeTime } from '../workspace/components/shared';
import { useAllWorkspaces, type AllWorkspaceRow } from '../workspace/hooks/useAllWorkspaces';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

interface WorkspaceSelectorProps {
  onSelectChatroom: (chatroomId: string) => void;
}

/**
 * Returns the final path component of a working directory for card titles.
 *
 * Client-safe replacement for `path.basename`: handles both POSIX and Windows
 * separators, strips trailing separators so `/tmp/project-a/` resolves to
 * `project-a`, and falls back to the input when nothing remains (e.g. a root
 * path or empty string).
 */
// Exported so WorkspaceSelector.test.tsx can cover the edge cases directly.
// fallow-ignore-next-line unused-export
export function getWorkspacePathName(workingDir: string): string {
  const trimmed = workingDir.replace(/[/\\]+$/, '');
  if (!trimmed) return workingDir;
  return (
    trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || workingDir
  );
}

/**
 * Filters workspaces by a search query.
 * Matches against machine display hostname and working directory.
 */
function filterWorkspaces(workspaces: AllWorkspaceRow[], query: string): AllWorkspaceRow[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return workspaces;

  return workspaces.filter((ws) => {
    const hostname = getWorkspaceDisplayHostname(ws).toLowerCase();
    const workingDir = ws.workingDir.toLowerCase();
    return hostname.includes(lower) || workingDir.includes(lower);
  });
}

export function WorkspaceSelector({ onSelectChatroom }: WorkspaceSelectorProps) {
  const { workspaces, isLoading } = useAllWorkspaces();
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => filterWorkspaces(workspaces, searchQuery),
    [workspaces, searchQuery]
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  if (isLoading) {
    return <WorkspaceLoadingState />;
  }

  if (workspaces.length === 0) {
    return <WorkspaceEmptyState />;
  }

  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      {/* Header */}
      <div className="mb-6 border-b-2 border-chatroom-border pb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Workspaces</h1>
        <p className="text-chatroom-text-muted text-sm">
          Every registered workspace across your chatrooms
        </p>
      </div>

      {/* Search Input */}
      <div className="mb-6">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspaces..."
            className="w-full bg-chatroom-bg-surface border-2 border-chatroom-border text-chatroom-text-primary pl-9 pr-9 py-2 text-xs font-mono placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Workspace Grid */}
      <WorkspaceGrid workspaces={filtered} onSelectChatroom={onSelectChatroom} />
    </div>
  );
}

function WorkspaceLoadingState() {
  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <ChatroomLoader size="md" />
        <span className="text-chatroom-text-muted text-sm">Loading workspaces...</span>
      </div>
    </div>
  );
}

function WorkspaceEmptyState() {
  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      {/* Header */}
      <div className="mb-8 border-b-2 border-chatroom-border pb-6">
        <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Workspaces</h1>
        <p className="text-chatroom-text-muted text-sm">
          All registered workspaces across your chatrooms
        </p>
      </div>
      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <span className="text-chatroom-text-muted text-base mb-2">
          No workspaces registered yet
        </span>
        <p className="text-chatroom-text-muted text-sm max-w-md">
          Workspaces appear here when your machine daemons connect and register a working directory
          in a chatroom.
        </p>
      </div>
    </div>
  );
}

function WorkspaceGrid({
  workspaces,
  onSelectChatroom,
}: {
  workspaces: AllWorkspaceRow[];
  onSelectChatroom: (chatroomId: string) => void;
}) {
  if (workspaces.length === 0) {
    return (
      <div className="text-center py-12 text-chatroom-text-muted">
        No workspaces match your search
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {workspaces.map((ws) => (
        <WorkspaceCard key={ws._id} ws={ws} onSelectChatroom={onSelectChatroom} />
      ))}
    </div>
  );
}

interface WorkspaceCardProps {
  ws: AllWorkspaceRow;
  onSelectChatroom: (chatroomId: string) => void;
}

const WorkspaceCard = memo(function WorkspaceCard({ ws, onSelectChatroom }: WorkspaceCardProps) {
  const machineName = getWorkspaceDisplayHostname(ws);
  const workspaceName = getWorkspacePathName(ws.workingDir) || machineName;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelectChatroom(ws.chatroomId);
      }
    },
    [onSelectChatroom, ws.chatroomId]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className="bg-chatroom-bg-surface border-2 border-chatroom-border p-4 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer"
      onClick={() => onSelectChatroom(ws.chatroomId)}
      onKeyDown={handleKeyDown}
    >
      <div className="flex justify-between items-start gap-2 mb-3">
        <span
          className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary truncate min-w-0"
          title={ws.workingDir}
        >
          {workspaceName}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary border-2 border-chatroom-border px-2 py-0.5 truncate shrink-0">
          {machineName}
        </span>
      </div>
      <div
        className="text-xs font-mono text-chatroom-text-primary truncate mb-3"
        title={ws.workingDir}
      >
        {ws.workingDir}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-chatroom-text-muted">
        Registered {formatRelativeTime(ws.registeredAt)}
      </div>
    </div>
  );
});
