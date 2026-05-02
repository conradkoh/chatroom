'use client';

import { AlertTriangle, Trash2 } from 'lucide-react';
import { memo, useState, useEffect, useCallback } from 'react';

import type { FullDiffState } from '../types/git';
import { parseDiff, basename, type DiffLine, type FileDiffSection } from '../utils/diff-parser';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSendLocalAction } from '@/hooks/useSendLocalAction';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceDiffViewerProps {
  state: FullDiffState;
  onRequest?: () => void;
  /** Machine ID for git discard operations. */
  machineId?: string;
  /** Working directory for git discard operations. */
  workingDir?: string;
  /** Callback when changes are discarded (to refresh diff). */
  onDiscard?: () => void;
}

// Make git operations available when machineId is provided
const canDiscard = (machineId?: string, workingDir?: string): boolean => {
  return !!machineId && !!workingDir;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const DiffLineRow = memo(function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return (
      <div className="flex text-chatroom-text-muted font-mono text-[10px] bg-chatroom-bg-tertiary border-b border-chatroom-border">
        {/* Gutter spanning both columns */}
        <div className="w-[70px] shrink-0 px-1 text-right border-r border-chatroom-border" />
        {/* Hunk content */}
        <div className="px-3 py-0.5 whitespace-pre-wrap break-words min-w-0">{line.content}</div>
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
        <div className="font-mono text-[11px] whitespace-pre-wrap break-words min-w-0 px-3 py-px">
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
        <div className="font-mono text-[11px] whitespace-pre-wrap break-words min-w-0 px-3 py-px">
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
      <div className="font-mono text-[11px] whitespace-pre-wrap break-words min-w-0 px-3 py-px">
        {line.content}
      </div>
    </div>
  );
});

const FileDiffBlock = memo(function FileDiffBlock({ section }: { section: FileDiffSection }) {
  return (
    <div className="border border-chatroom-border rounded-none overflow-hidden">
      {/* File header */}
      <div className="bg-chatroom-bg-tertiary px-3 py-1.5 font-mono text-[11px] text-chatroom-text-secondary border-b border-chatroom-border truncate">
        {section.filePath || '(unknown file)'}
      </div>

      {/* Diff lines */}
      <div className="overflow-hidden">
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

const STATUS_CONFIG: Record<FileDiffSection['status'], { letter: string; className: string }> = {
  created: { letter: 'A', className: 'text-green-600 dark:text-green-400' },
  deleted: { letter: 'D', className: 'text-red-600 dark:text-red-400' },
  modified: { letter: 'M', className: 'text-yellow-600 dark:text-yellow-400' },
};

interface FileListSidebarProps {
  sections: FileDiffSection[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

const FileListContent = memo(function FileListContent({
  sections,
  selectedIdx,
  onSelect,
}: FileListSidebarProps) {
  return (
    <>
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
                : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50'
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
                isActive ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary'
              )}
            >
              {name}
            </span>
          </button>
        );
      })}
    </>
  );
});

const FileListSidebar = memo(function FileListSidebar({
  sections,
  selectedIdx,
  onSelect,
}: FileListSidebarProps) {
  return (
    <div className="w-56 shrink-0 border-r border-chatroom-border overflow-y-auto flex flex-col">
      <FileListContent sections={sections} selectedIdx={selectedIdx} onSelect={onSelect} />
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
  onRequest,
  machineId,
  workingDir,
  onDiscard,
}: WorkspaceDiffViewerProps) {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [discardFileConfirmOpen, setDiscardFileConfirmOpen] = useState(false);
  const [selectedFileForDiscard, setSelectedFileForDiscard] = useState<string | null>(null);
  const sendLocalAction = useSendLocalAction();

  // Reset selection when diff content changes
  useEffect(() => {
    setSelectedFileIdx(0);
  }, [state.status === 'available' ? state.content : null]);

  const handleDiscardFile = useCallback(
    async (filePath: string) => {
      if (!machineId || !workingDir) return;
      // Format: "directory::filePath" to pass both to the handler
      const combinedPath = `${workingDir}::${filePath}`;
      // Use type assertion since Convex types haven't been regenerated yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendLocalAction(machineId, 'git-discard-file' as any, combinedPath);
      onDiscard?.();
    },
    [machineId, workingDir, sendLocalAction, onDiscard]
  );

  const handleDiscardAll = useCallback(async () => {
    if (!machineId || !workingDir) return;
    // Use type assertion since Convex types haven't been regenerated yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendLocalAction(machineId, 'git-discard-all' as any, workingDir);
    setDiscardConfirmOpen(false);
    onDiscard?.();
  }, [machineId, workingDir, sendLocalAction, onDiscard]);

  if (state.status === 'idle' || state.status === 'loading') {
    return <LoadingSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 p-4">
        <div className="flex items-center gap-1.5 text-chatroom-status-error text-[11px]">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{state.message}</span>
        </div>
        {onRequest && (
          <button
            type="button"
            onClick={onRequest}
            className="text-[11px] text-chatroom-text-secondary hover:text-chatroom-text-primary transition-colors underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // state.status === 'available'
  const sections = parseDiff(state.content);

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 p-4">
        <span className="text-[11px] text-chatroom-text-muted">✓ No changes</span>
        <span className="text-[10px] text-chatroom-text-muted">Working tree is clean</span>
      </div>
    );
  }

  const selectedSection = sections[selectedFileIdx] ?? sections[0]!;
  const showDiscard = canDiscard(machineId, workingDir);

  return (
    <>
      <div className="flex flex-row h-full">
        {/* File list sidebar with context menu */}
        {showDiscard ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="w-56 shrink-0 border-r border-chatroom-border overflow-y-auto flex flex-col">
                <FileListContent
                  sections={sections}
                  selectedIdx={selectedFileIdx}
                  onSelect={setSelectedFileIdx}
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  const filePath = sections[selectedFileIdx]?.filePath;
                  if (filePath) {
                    setSelectedFileForDiscard(filePath);
                    setDiscardFileConfirmOpen(true);
                  }
                }}
              >
                <Trash2 size={12} className="mr-2" />
                Discard changes to this file
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setDiscardConfirmOpen(true)}>
                <Trash2 size={12} className="mr-2" />
                Discard all changes
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <FileListSidebar
            sections={sections}
            selectedIdx={selectedFileIdx}
            onSelect={setSelectedFileIdx}
          />
        )}

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

      {/* Discard file confirmation dialog */}
      <AlertDialog open={discardFileConfirmOpen} onOpenChange={setDiscardFileConfirmOpen}>
        <AlertDialogContent className="bg-chatroom-bg-primary border-chatroom-border-strong">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-chatroom-text-primary">
              Discard changes to this file?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-chatroom-text-secondary">
              This will revert <span className="font-mono">{selectedFileForDiscard}</span> to its
              last committed state. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-chatroom-border pt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedFileForDiscard) {
                  handleDiscardFile(selectedFileForDiscard);
                  setDiscardFileConfirmOpen(false);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard all confirmation dialog */}
      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent className="bg-chatroom-bg-primary border-chatroom-border-strong">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-chatroom-text-primary">
              Discard all changes?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-chatroom-text-secondary">
              This will revert all tracked files to their last committed state and remove all
              untracked files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-chatroom-border pt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardAll} className="bg-red-600 hover:bg-red-700">
              Discard All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
