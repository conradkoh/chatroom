'use client';

/**
 * SourceControlPanel — three-column git interface for the ActivityBar.
 *
 * Column 1 (slim left, ~280px): stacked:
 *   - Diff summary for working-tree (clickable)
 *   - Commit history (scrollable, each clickable)
 * Column 2 (middle): files in the selected diff/commit
 * Column 3 (right): unified diff for the selected file
 */

import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useWorkspaceGit,
  useFullDiff,
  useCommitDetail,
  useRecentCommits,
  useLoadMoreCommits,
} from '../../hooks/useWorkspaceGit';
import type { GitCommit } from '../../types/git';
import { buildFileDiffContent } from '../../utils/buildFileDiffContent';
import { parseDiff, basename, dirname } from '../../utils/diff-parser';
import type { FileDiffSection } from '../../utils/diff-parser';
import { getFileIcon } from '../../utils/file-icons';
import { buildGitSelectionSource } from '../../utils/gitSelectionSource';
import { CommitDetailHeader } from '../CommitDetailHeader';
import { DiffSelectionSurface } from '../DiffSelectionSurface';
import { WorkspaceDiffViewer } from '../WorkspaceDiffViewer';
import { WorkspaceGitLog } from '../WorkspaceGitLog';

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { parseRepoSlug } from '@/lib/git-remote';
import { cn } from '@/lib/utils';
import { usePersistedState } from '@/modules/chatroom/hooks/usePersistedState';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceControlPanelProps {
  machineId: string;
  workingDir: string;
  chatroomId: string;
  /** Called when user presses Cmd+I with a text selection in commit or diff content */
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
}

type ActiveSource = { type: 'working-tree' } | { type: 'commit'; sha: string };

// ─── Shared: Section Header ─────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string;
  className?: string;
}

const SectionHeader = memo(function SectionHeader({ label, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider',
        'text-foreground bg-muted/40 border-b border-border shrink-0',
        className
      )}
    >
      {label}
    </div>
  );
});

// ─── Left Rail: Diff Summary ──────────────────────────────────────────────────

interface DiffSummaryProps {
  isDirty: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
  isSelected: boolean;
  onSelect: () => void;
}

const DiffSummary = memo(function DiffSummary({
  isDirty,
  filesChanged,
  insertions,
  deletions,
  isSelected,
  onSelect,
}: DiffSummaryProps) {
  if (!isDirty) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">No uncommitted changes</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors hover:bg-chatroom-bg-hover cursor-pointer',
        isSelected
          ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
          : 'border-l-2 border-transparent'
      )}
    >
      <span className="text-xs font-medium text-chatroom-text-primary">Working Changes</span>
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">
          {filesChanged} file{filesChanged !== 1 ? 's' : ''} ·
        </span>
        <span className="text-green-600 dark:text-green-400">+{insertions}</span>
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      </span>
    </button>
  );
});

// ─── Middle: File List ────────────────────────────────────────────────────────

/** Memoized file-type icon — resolves the correct icon+color for a file path. */
const FileTypeIcon = memo(function FileTypeIcon({ filePath }: { filePath: string }) {
  const { Icon, color } = getFileIcon(filePath);
  return <Icon size={12} aria-hidden className="shrink-0" style={color ? { color } : undefined} />;
});

interface FileListProps {
  files: FileDiffSection[];
  selectedFile: string | null;
  isLoading: boolean;
  onSelectFile: (filePath: string) => void;
}

const FileList = memo(function FileList({
  files,
  selectedFile,
  isLoading,
  onSelectFile,
}: FileListProps) {
  const groups = useMemo(() => groupFilesByDirectory(files), [files]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Loading files…
      </div>
    );
  }

  if (files.length === 0) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">No files in this diff.</div>;
  }

  return (
    <div className="overflow-y-auto flex-1">
      {groups.map(({ dir, files: groupFiles }) => (
        <div key={dir}>
          {/* Sticky directory header */}
          <div
            className="sticky top-0 z-10 bg-chatroom-bg-secondary px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-chatroom-border truncate"
            title={dir}
          >
            {dir}
          </div>
          {/* Files in this directory */}
          {groupFiles.map((file) => (
            <button
              key={file.filePath}
              type="button"
              onClick={() => onSelectFile(file.filePath)}
              className={cn(
                'w-full text-left px-3 py-1.5 flex flex-row items-center gap-2 transition-colors hover:bg-chatroom-bg-hover cursor-pointer min-w-0',
                selectedFile === file.filePath
                  ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
                  : 'border-l-2 border-transparent'
              )}
            >
              {/* Status badge — vertically centered, spans both content rows */}
              <span
                className={cn('text-[10px] font-mono shrink-0 self-center w-3', {
                  'text-green-500': file.status === 'created',
                  'text-red-500': file.status === 'deleted',
                  'text-yellow-500': file.status === 'modified',
                })}
              >
                {file.status === 'created' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
              </span>
              {/* Right column: top row = icon + filename; bottom row = directory */}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="flex items-center gap-1.5 min-w-0">
                  <FileTypeIcon filePath={file.filePath} />
                  <span className="text-xs font-medium text-chatroom-text-primary truncate">
                    {basename(file.filePath)}
                  </span>
                </span>
                {dirname(file.filePath) !== '.' && (
                  <span
                    className="text-[10px] text-muted-foreground truncate"
                    title={file.filePath}
                  >
                    {dirname(file.filePath)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});

// ─── Right: File Diff ─────────────────────────────────────────────────────────

interface FileDiffProps {
  files: FileDiffSection[];
  selectedFile: string | null;
  fullContent: string;
  isLoading: boolean;
  selectionSource?: string;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
}

const FileDiff = memo(function FileDiff({
  files,
  selectedFile,
  fullContent,
  isLoading,
  selectionSource,
  onSendSelectionToComposer,
}: FileDiffProps) {
  const fileSection = useMemo(
    () => files.find((f) => f.filePath === selectedFile) ?? null,
    [files, selectedFile]
  );

  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Select a file to view its diff.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (!fileSection) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        File diff not found.
      </div>
    );
  }

  // Render just the lines for this file using WorkspaceDiffViewer's underlying pattern.
  // We pass the full diff content filtered to this file's section.
  // Build a minimal diff string: just this file's lines
  const fileDiffContent = buildFileDiffContent(fileSection, fullContent);

  // Use WorkspaceDiffViewer by synthesizing a minimal FullDiffState for this file
  return (
    <DiffSelectionSurface
      selectionSource={selectionSource ?? ''}
      onSendSelectionToComposer={onSendSelectionToComposer}
      className="flex-1 overflow-hidden"
    >
      <WorkspaceDiffViewer
        state={{
          status: 'available',
          content: fileDiffContent,
          truncated: false,
          diffStat: { filesChanged: 1, insertions: 0, deletions: 0 },
        }}
        showFileList={false}
      />
    </DiffSelectionSurface>
  );
});

// ─── Layout Persistence ─────────────────────────────────────────────────────

const SC_OUTER_KEY = 'webapp:sourceControlPanelOuterSizes';
const SC_OUTER_DEFAULT: readonly number[] = [28, 72] as const;
const SC_INNER_KEY = 'webapp:sourceControlPanelInnerSizes';
const SC_INNER_DEFAULT: readonly number[] = [31, 69] as const;
const isValidLayout2 = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length === 2 &&
  (v as unknown[]).every((n) => typeof n === 'number' && n >= 0 && n <= 100);

// ─── Main Component ───────────────────────────────────────────────────────────

export const SourceControlPanel = memo(function SourceControlPanel({
  machineId,
  workingDir,
  chatroomId: _chatroomId,
  onSendSelectionToComposer,
}: SourceControlPanelProps) {
  // Layout persistence — nested resizable groups
  const [outerSizes, setOuterSizes] = usePersistedState<number[]>(
    SC_OUTER_KEY,
    [...SC_OUTER_DEFAULT],
    {
      validate: isValidLayout2,
    }
  );
  const [innerSizes, setInnerSizes] = usePersistedState<number[]>(
    SC_INNER_KEY,
    [...SC_INNER_DEFAULT],
    {
      validate: isValidLayout2,
    }
  );
  // onLayoutChanged fires only after pointer release — no debounce needed
  const handleOuterLayout = useCallback(
    (layout: { [id: string]: number }) => {
      const next = [layout['sc-left'] ?? outerSizes[0], layout['sc-content'] ?? outerSizes[1]];
      if (isValidLayout2(next)) setOuterSizes(next);
    },
    [setOuterSizes, outerSizes]
  );
  const handleInnerLayout = useCallback(
    (layout: { [id: string]: number }) => {
      const next = [layout['sc-middle'] ?? innerSizes[0], layout['sc-right'] ?? innerSizes[1]];
      if (isValidLayout2(next)) setInnerSizes(next);
    },
    [setInnerSizes, innerSizes]
  );

  // Git state (branch, dirty status, diff stats)
  const gitState = useWorkspaceGit(machineId, workingDir);

  // Full working-tree diff
  const { state: fullDiffState, request: requestFullDiff } = useFullDiff(machineId, workingDir);

  // Commit detail for the selected commit
  const { state: commitDetailState, request: requestCommitDetail } = useCommitDetail(
    machineId,
    workingDir
  );

  // Commit history
  const { state: recentCommitsState, request: requestRecentCommits } = useRecentCommits(
    machineId,
    workingDir
  );
  const { loadMore: loadMoreCommits, loading: isLoadingMore } = useLoadMoreCommits(
    machineId,
    workingDir
  );

  // Active selection: working-tree or a commit SHA
  const [activeSource, setActiveSource] = useState<ActiveSource | null>(null);
  const activeSourceRef = useRef<ActiveSource | null>(null);
  activeSourceRef.current = activeSource;

  // Selected file
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Auto-request on mount
  useEffect(() => {
    if (machineId && workingDir) {
      requestRecentCommits();
    }
  }, [machineId, workingDir, requestRecentCommits]);

  // Request commit detail when a commit is selected
  useEffect(() => {
    if (activeSource?.type === 'commit') {
      requestCommitDetail(activeSource.sha);
    }
  }, [activeSource, requestCommitDetail]);

  // Reset selected file when source changes
  useEffect(() => {
    setSelectedFile(null);
  }, [activeSource]);

  // Parse files from the active diff
  const files: FileDiffSection[] = useMemo(() => {
    if (!activeSource) return [];
    if (activeSource.type === 'working-tree') {
      if (fullDiffState.status === 'available') {
        return parseDiff(fullDiffState.content);
      }
      return [];
    }
    if (commitDetailState.status === 'available') {
      return parseDiff(commitDetailState.content);
    }
    return [];
  }, [activeSource, fullDiffState, commitDetailState]);

  const isMiddleLoading = useMemo(() => {
    if (!activeSource) return false;
    if (activeSource.type === 'working-tree') {
      return fullDiffState.status === 'loading';
    }
    return commitDetailState.status === 'loading';
  }, [activeSource, fullDiffState, commitDetailState]);

  const fullDiffContent = useMemo(() => {
    if (!activeSource) return '';
    if (activeSource.type === 'working-tree') {
      return fullDiffState.status === 'available' ? fullDiffState.content : '';
    }
    return commitDetailState.status === 'available' ? commitDetailState.content : '';
  }, [activeSource, fullDiffState, commitDetailState]);

  const isRightLoading = isMiddleLoading;

  const handleSelectWorkingTree = useCallback(() => {
    setActiveSource({ type: 'working-tree' });
    requestFullDiff();
  }, [requestFullDiff]);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      if (activeSourceRef.current?.type === 'working-tree') {
        requestFullDiff();
      }
    },
    [requestFullDiff]
  );

  const handleSelectCommit = useCallback((sha: string) => {
    setActiveSource({ type: 'commit', sha });
  }, []);

  const isDirty = gitState.status === 'available' && gitState.isDirty;
  const diffStat =
    gitState.status === 'available'
      ? gitState.diffStat
      : { filesChanged: 0, insertions: 0, deletions: 0 };
  const selectedSha = activeSource?.type === 'commit' ? activeSource.sha : null;

  const commits: GitCommit[] =
    recentCommitsState.status === 'available' ? recentCommitsState.commits : [];
  const hasMoreCommits =
    recentCommitsState.status === 'available' ? recentCommitsState.hasMoreCommits : false;

  // Derive repo slug from remotes
  const repoSlug = useMemo(() => {
    if (gitState.status !== 'available') return null;
    const remotes = gitState.remotes;
    if (!remotes || remotes.length === 0) return null;
    const origin = remotes.find((r: { name: string }) => r.name === 'origin') ?? remotes[0];
    return origin ? parseRepoSlug(origin.url) : null;
  }, [gitState]);

  // Look up the selected commit object (has body)
  const selectedCommit: GitCommit | null = useMemo(() => {
    if (activeSource?.type !== 'commit') return null;
    return commits.find((c) => c.sha === activeSource.sha) ?? null;
  }, [activeSource, commits]);

  return (
    <ResizablePanelGroup className="h-full" onLayoutChanged={handleOuterLayout}>
      {/* ── Left Rail ────────────────────────────────────────────── */}
      <ResizablePanel id="sc-left" defaultSize={outerSizes[0]} minSize={15}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Diff summary */}
          <div className="shrink-0 border-b border-border">
            <SectionHeader label="Changes" />
            {gitState.status === 'loading' ? (
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </div>
            ) : (
              <DiffSummary
                isDirty={isDirty}
                filesChanged={diffStat.filesChanged}
                insertions={diffStat.insertions}
                deletions={diffStat.deletions}
                isSelected={activeSource?.type === 'working-tree'}
                onSelect={handleSelectWorkingTree}
              />
            )}
          </div>

          {/* Commit history */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <SectionHeader label="History" className="border-t border-border" />
            <div className="flex-1 overflow-y-auto">
              <WorkspaceGitLog
                commits={commits}
                hasMore={hasMoreCommits}
                status={recentCommitsState.status}
                selectedSha={selectedSha}
                loadingMore={isLoadingMore}
                onSelectCommit={handleSelectCommit}
                onRequest={requestRecentCommits}
                onLoadMore={loadMoreCommits}
              />
            </div>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* ── Content: Header + File List + Diff ─────────────────────── */}
      <ResizablePanel id="sc-content" defaultSize={outerSizes[1]} minSize={40}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Commit detail header — visible only for commits, not working tree */}
          {selectedCommit ? (
            <CommitDetailHeader
              commit={selectedCommit}
              repoSlug={repoSlug}
              onSendSelectionToComposer={onSendSelectionToComposer}
            />
          ) : null}
          {/* Nested resizable panels: file list + diff viewer */}
          <ResizablePanelGroup onLayoutChanged={handleInnerLayout} className="flex-1">
            {/* ── Middle: File List ─────────────────────────────────────── */}
            <ResizablePanel id="sc-middle" defaultSize={innerSizes[0]} minSize={20}>
              <div className="flex flex-col h-full overflow-hidden">
                <SectionHeader label="Files" />
                {!activeSource ? (
                  <div className="flex-1 flex items-center justify-center px-4 py-3 text-xs text-muted-foreground text-center">
                    Select a change or commit to see files.
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <FileList
                      files={files}
                      selectedFile={selectedFile}
                      isLoading={isMiddleLoading}
                      onSelectFile={handleSelectFile}
                    />
                  </div>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* ── Right: File Diff ──────────────────────────────────────── */}
            <ResizablePanel id="sc-right" defaultSize={innerSizes[1]} minSize={30}>
              <div className="flex flex-col h-full overflow-hidden">
                {!selectedFile ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                    Select a file to view its diff.
                  </div>
                ) : (
                  <FileDiff
                    files={files}
                    selectedFile={selectedFile}
                    fullContent={fullDiffContent}
                    isLoading={isRightLoading}
                    selectionSource={buildGitSelectionSource(
                      activeSource,
                      'file',
                      selectedFile ?? undefined
                    )}
                    onSendSelectionToComposer={onSendSelectionToComposer}
                  />
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FileGroup {
  dir: string;
  files: FileDiffSection[];
}

/**
 * Groups a list of FileDiffSection entries by their directory.
 * Groups and files within each group are sorted alphabetically.
 * Root-level files (no directory) are placed in the "." group.
 */
export function groupFilesByDirectory(files: FileDiffSection[]): FileGroup[] {
  const map = new Map<string, FileDiffSection[]>();

  for (const file of files) {
    const dir = dirname(file.filePath);
    if (!map.has(dir)) {
      map.set(dir, []);
    }
    const group = map.get(dir);
    if (group) {
      group.push(file);
    }
  }

  // Sort files within each group alphabetically by basename
  for (const groupFiles of map.values()) {
    groupFiles.sort((a, b) => basename(a.filePath).localeCompare(basename(b.filePath)));
  }

  // Sort groups alphabetically by directory name
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, groupFiles]) => ({ dir, files: groupFiles }));
}
