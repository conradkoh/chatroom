'use client';

import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { FullDiffState } from '../types/git';

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
}

interface FileDiffSection {
  /** File path extracted from the +++ b/... line. */
  filePath: string;
  lines: DiffLine[];
}

// ─── Diff Parser ──────────────────────────────────────────────────────────────

/**
 * Parses a unified diff string into per-file sections.
 * Splits on `diff --git` boundaries and classifies each line.
 * Tracks old/new line numbers from @@ hunk headers.
 */
function parseDiff(content: string): FileDiffSection[] {
  if (!content.trim()) return [];

  const rawSections = content.split(/^(?=diff --git )/m).filter(Boolean);

  return rawSections.map((section): FileDiffSection => {
    const lines = section.split('\n');

    // Extract file path from `+++ b/<path>` or fall back to the diff header
    let filePath = '';
    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        filePath = line.slice(6);
        break;
      }
      if (line.startsWith('+++ /dev/null')) {
        filePath = '(deleted file)';
        break;
      }
      if (line.startsWith('diff --git ')) {
        // e.g. "diff --git a/foo/bar.ts b/foo/bar.ts"
        const match = /diff --git a\/.+ b\/(.+)/.exec(line);
        if (match) filePath = match[1]!;
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
        if (raw === '' && parsedLines.length > 0 && parsedLines[parsedLines.length - 1]!.type === 'hunk') {
          // skip trailing empty lines after hunk headers
          continue;
        }
        parsedLines.push({ type: 'context', content: raw, oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
      }
    }

    return { filePath, lines: parsedLines };
  });
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
        <div className="font-mono text-[11px] whitespace-pre px-3 py-px">{line.content}</div>
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
        <div className="font-mono text-[11px] whitespace-pre px-3 py-px">{line.content}</div>
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

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Renders a unified diff with syntax highlighting and line numbers.
 *
 * States: idle | loading | error | available
 */
export const WorkspaceDiffViewer = memo(function WorkspaceDiffViewer({
  state,
}: WorkspaceDiffViewerProps) {
  if (state.status === 'idle') {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-status-error text-[11px]">
        <AlertTriangle size={13} className="shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }

  // state.status === 'available'
  const sections = parseDiff(state.content);

  return (
    <div className="flex flex-col gap-2">
      {/* Truncation warning */}
      {state.truncated && (
        <div className="flex items-center gap-1.5 text-chatroom-status-warning text-[11px] py-0.5">
          <AlertTriangle size={12} className="shrink-0" />
          Diff truncated (exceeds 500KB)
        </div>
      )}

      {/* File diff sections — no max-height, parent handles scrolling */}
      <div className="flex flex-col gap-2">
        {sections.length === 0 ? (
          <div className="text-[11px] text-chatroom-text-muted">No changes</div>
        ) : (
          sections.map((section, idx) => <FileDiffBlock key={idx} section={section} />)
        )}
      </div>
    </div>
  );
});
