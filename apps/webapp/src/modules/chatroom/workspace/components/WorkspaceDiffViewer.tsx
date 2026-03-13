'use client';

import { memo, useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { FullDiffState } from '../types/git';
import { computeIntraLineDiff, type DiffSegment } from '../utils/intra-line-diff';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceDiffViewerProps {
  state: FullDiffState;
  onRequest?: () => void;
}

interface DiffLine {
  type: 'addition' | 'deletion' | 'hunk' | 'context';
  content: string;
  oldLineNum?: number; // line number in original file
  newLineNum?: number; // line number in new file
  /** Intra-line diff segments — present when this line is part of a paired deletion/addition */
  intraSegments?: DiffSegment[];
}

interface FileDiffSection {
  /** File path extracted from the +++ b/... line. */
  filePath: string;
  lines: DiffLine[];
  status: 'created' | 'deleted' | 'modified';
}

// ─── Diff Parser ──────────────────────────────────────────────────────────────

/**
 * Post-processing pass: pairs consecutive deletion/addition blocks and enriches
 * them with character-level intra-line diff segments.
 */
function enrichWithIntraLineDiff(lines: DiffLine[]): DiffLine[] {
  const result = [...lines];
  let i = 0;

  while (i < result.length) {
    // Scan for a block of consecutive deletions
    const delStart = i;
    while (i < result.length && result[i]!.type === 'deletion') i++;
    const delEnd = i;

    // Immediately followed by a block of consecutive additions
    const addStart = i;
    while (i < result.length && result[i]!.type === 'addition') i++;
    const addEnd = i;

    const delCount = delEnd - delStart;
    const addCount = addEnd - addStart;

    if (delCount > 0 && addCount > 0) {
      // Pair up: min(delCount, addCount) pairs
      const pairs = Math.min(delCount, addCount);
      for (let p = 0; p < pairs; p++) {
        const delLine = result[delStart + p]!;
        const addLine = result[addStart + p]!;
        // Strip the leading -/+ for diff computation
        const oldContent = delLine.content.slice(1);
        const newContent = addLine.content.slice(1);
        const intra = computeIntraLineDiff(oldContent, newContent);
        result[delStart + p] = { ...delLine, intraSegments: intra.oldSegments };
        result[addStart + p] = { ...addLine, intraSegments: intra.newSegments };
      }
    }

    // If no deletion block was found, advance past the current line
    if (i === delStart) i++;
  }

  return result;
}

/**
 * Parses a unified diff string into per-file sections.
 * Splits on `diff --git` boundaries and classifies each line.
 * Tracks old/new line numbers from @@ hunk headers.
 * Detects file status (created/deleted/modified).
 */
function parseDiff(content: string): FileDiffSection[] {
  if (!content.trim()) return [];

  const rawSections = content
    .split(/^(?=diff --git )/m)
    .filter((s) => s.startsWith('diff --git '));

  return rawSections.map((section): FileDiffSection => {
    const lines = section.split('\n');

    // Extract file path from `+++ b/<path>` or fall back to the diff header
    let filePath = '';
    let status: FileDiffSection['status'] = 'modified';

    for (const line of lines) {
      if (line.startsWith('new file mode') || line.startsWith('--- /dev/null')) {
        status = 'created';
      }
      if (line.startsWith('deleted file mode') || line.startsWith('+++ /dev/null')) {
        status = 'deleted';
      }
      if (line.startsWith('+++ b/')) {
        filePath = line.slice(6);
      } else if (line.startsWith('+++ /dev/null')) {
        filePath = filePath || '(deleted file)';
      }
      if (line.startsWith('diff --git ')) {
        // e.g. "diff --git a/foo/bar.ts b/foo/bar.ts"
        const match = /diff --git a\/.+ b\/(.+)/.exec(line);
        if (match) filePath = filePath || match[1]!;
      }
    }

    const parsedLines: DiffLine[] = [];
    let pastHeader = false;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const raw of lines) {
      // Skip the meta-header lines (diff --git, index, --- a/, +++ b/)
      if (
        raw.startsWith('diff --git ') ||
        raw.startsWith('index ') ||
        raw.startsWith('--- ') ||
        raw.startsWith('+++ ') ||
        raw.startsWith('new file mode') ||
        raw.startsWith('deleted file mode') ||
        raw.startsWith('old mode') ||
        raw.startsWith('new mode')
      ) {
        pastHeader = true;
        continue;
      }

      if (!pastHeader) continue;

      if (raw.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
        if (match) {
          oldLineNum = parseInt(match[1]!, 10);
          newLineNum = parseInt(match[2]!, 10);
        }
        parsedLines.push({ type: 'hunk', content: raw });
      } else if (raw.startsWith('+')) {
        parsedLines.push({ type: 'addition', content: raw, newLineNum: newLineNum++ });
      } else if (raw.startsWith('-')) {
        parsedLines.push({ type: 'deletion', content: raw, oldLineNum: oldLineNum++ });
      } else {
        // context line (or empty trailing line)
        if (
          raw === '' &&
          parsedLines.length > 0 &&
          parsedLines[parsedLines.length - 1]!.type === 'hunk'
        ) {
          // skip trailing empty lines after hunk headers
          continue;
        }
        parsedLines.push({
          type: 'context',
          content: raw,
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++,
        });
      }
    }

    return { filePath, lines: enrichWithIntraLineDiff(parsedLines), status };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
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
