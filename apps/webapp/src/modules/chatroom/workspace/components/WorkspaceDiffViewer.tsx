'use client';

import { memo, useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { FullDiffState } from '../types/git';
import { parseDiff, basename, type DiffLine, type FileDiffSection } from '../utils/diff-parser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceDiffViewerProps {
  state: FullDiffState;
  onRequest?: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DiffLineRow = memo(function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return (
      <div className="flex text-chatroom-text-muted font-mono text-[10px] bg-chatroom-bg-tertiary border-b border-chatroom-border">
        {/* Gutter spanning both columns */}
        <div className="w-[70px] shrink-0 px-1 text-right border-r border-chatroom-border" />
        {/* Hunk content */}
        <div className="px-3 py-0.5 whitespace-pre">{line.content}</div>
      </div>
    );
  }

  if (line.type === 'addition') {
    return (
      <div className="flex bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300">
        {/* Old line number — empty */}
        <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none" />
        {/* New line number */}
        <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none">
          {line.newLineNum}
        </div>
        {/* Content */}
        <div className="font-mono text-[11px] whitespace-pre px-3 py-px">
          {line.intraSegments ? (
            <>
              <span>{line.content[0]}</span>
              {line.intraSegments.map((seg, i) => (
                <span
                  key={i}
                  className={seg.type === 'changed' ? 'bg-green-200 dark:bg-green-800/40' : ''}
                >
                  {seg.text}
                </span>
              ))}
            </>
          ) : (
            line.content
          )}
        </div>
      </div>
    );
  }

  if (line.type === 'deletion') {
    return (
      <div className="flex bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300">
        {/* Old line number */}
        <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none">
          {line.oldLineNum}
        </div>
        {/* New line number — empty */}
        <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none" />
        {/* Content */}
        <div className="font-mono text-[11px] whitespace-pre px-3 py-px">
          {line.intraSegments ? (
            <>
              <span>{line.content[0]}</span>
              {line.intraSegments.map((seg, i) => (
                <span
                  key={i}
                  className={seg.type === 'changed' ? 'bg-red-200 dark:bg-red-800/40' : ''}
                >
                  {seg.text}
                </span>
              ))}
            </>
          ) : (
            line.content
          )}
        </div>
      </div>
    );
  }

  // context
  return (
    <div className="flex text-chatroom-text-secondary">
      {/* Old line number */}
      <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none">
        {line.oldLineNum}
      </div>
      {/* New line number */}
      <div className="w-[35px] shrink-0 px-1 py-px text-right font-mono text-[10px] text-chatroom-text-muted border-r border-chatroom-border select-none">
        {line.newLineNum}
      </div>
      {/* Content */}
      <div className="font-mono text-[11px] whitespace-pre px-3 py-px">{line.content}</div>
    </div>
  );
});

const FileDiffBlock = memo(function FileDiffBlock({ section }: { section: FileDiffSection }) {
  return (
    <div className="border border-chatroom-border rounded-md overflow-hidden">
      {/* File header */}
      <div className="bg-chatroom-bg-tertiary px-3 py-1.5 font-mono text-[11px] text-chatroom-text-secondary border-b border-chatroom-border truncate">
        {section.filePath || '(unknown file)'}
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto">
        {section.lines.map((line, idx) => (
          <DiffLineRow key={idx} line={line} />
        ))}
        {section.lines.length === 0 && (
          <div className="text-[11px] text-chatroom-text-muted px-3 py-1">No changes</div>
        )}
      </div>
    </div>
  );
});

// ─── File List Sidebar ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  FileDiffSection['status'],
  { letter: string; className: string }
> = {
  created: { letter: 'A', className: 'text-green-600 dark:text-green-400' },
  deleted: { letter: 'D', className: 'text-red-600 dark:text-red-400' },
  modified: { letter: 'M', className: 'text-yellow-600 dark:text-yellow-400' },
};

interface FileListSidebarProps {
  sections: FileDiffSection[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

const FileListSidebar = memo(function FileListSidebar({
  sections,
  selectedIdx,
  onSelect,
}: FileListSidebarProps) {
  return (
    <div className="w-56 shrink-0 border-r border-chatroom-border overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-chatroom-border">
        <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Files
        </span>
      </div>

      {/* File list */}
      {sections.map((section, idx) => {
        const statusConfig = STATUS_CONFIG[section.status];
        const isActive = idx === selectedIdx;
        const name = basename(section.filePath) || '(unknown)';

        return (
          <button
            key={idx}
            type="button"
            title={section.filePath}
            onClick={() => onSelect(idx)}
            className={cn(
              'w-full text-left px-3 py-2 flex items-center gap-1.5 transition-colors',
              isActive
                ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
                : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50',
            )}
          >
            {/* Status indicator */}
            <span className={cn('text-[10px] font-bold shrink-0', statusConfig.className)}>
              {statusConfig.letter}
            </span>

            {/* File name */}
            <span
              className={cn(
                'font-mono text-[11px] truncate',
                isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary',
              )}
            >
              {name}
            </span>
          </button>
        );
      })}
    </div>
  );
});

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 py-1 p-4">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/6" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Renders a unified diff with syntax highlighting, line numbers, and a file
 * list sidebar for navigating between changed files.
 *
 * States: idle | loading | error | available
 */
export const WorkspaceDiffViewer = memo(function WorkspaceDiffViewer({
  state,
}: WorkspaceDiffViewerProps) {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);

  // Reset selection when diff content changes
  useEffect(() => {
    setSelectedFileIdx(0);
  }, [state.status === 'available' ? state.content : null]);

  if (state.status === 'idle' || state.status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-status-error text-[11px] p-4">
        <AlertTriangle size={13} className="shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }

  // state.status === 'available'
  const sections = parseDiff(state.content);

  if (sections.length === 0) {
    return (
      <div className="text-[11px] text-chatroom-text-muted p-4">No changes</div>
    );
  }

  const selectedSection = sections[selectedFileIdx] ?? sections[0]!;

  return (
    <div className="flex flex-row h-full">
      {/* File list sidebar */}
      <FileListSidebar
        sections={sections}
        selectedIdx={selectedFileIdx}
        onSelect={setSelectedFileIdx}
      />

      {/* Diff content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Truncation warning */}
        {state.truncated && (
          <div className="flex items-center gap-1.5 text-chatroom-status-warning text-[11px] px-4 py-2 border-b border-chatroom-border">
            <AlertTriangle size={12} className="shrink-0" />
            Diff truncated (exceeds 500KB)
          </div>
        )}

        <div className="p-4">
          <FileDiffBlock section={selectedSection} />
        </div>
      </div>
    </div>
  );
});
