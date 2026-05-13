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
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { parseDiff, basename } from '../../utils/diff-parser';
import type { FileDiffSection } from '../../utils/diff-parser';
import type { GitCommit } from '../../types/git';
import {
  useWorkspaceGit,
  useFullDiff,
  useCommitDetail,
  useRecentCommits,
  useLoadMoreCommits,
} from '../../hooks/useWorkspaceGit';
import { WorkspaceGitLog } from '../WorkspaceGitLog';
import { WorkspaceDiffViewer } from '../WorkspaceDiffViewer';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceControlPanelProps {
  machineId: string;
  workingDir: string;
  chatroomId: string;
}

type ActiveSource = { type: 'working-tree' } | { type: 'commit'; sha: string };

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
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No uncommitted changes
      </div>
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
        <span className="text-muted-foreground">{filesChanged} file{filesChanged !== 1 ? 's' : ''} ·</span>
        <span className="text-green-600 dark:text-green-400">+{insertions}</span>
        <span className="text-red-600 dark:text-red-400">-{deletions}</span>
      </span>
    </button>
  );
});

// ─── Middle: File List ────────────────────────────────────────────────────────

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
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20 gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Loading files…
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">No files in this diff.</div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1">
      {files.map((file) => (
        <button
          key={file.filePath}
          type="button"
          onClick={() => onSelectFile(file.filePath)}
          className={cn(
            'w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-chatroom-bg-hover cursor-pointer',
            selectedFile === file.filePath
              ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
              : 'border-l-2 border-transparent'
          )}
        >
          <span
            className={cn('text-[10px] font-mono shrink-0 w-3', {
              'text-green-500': file.status === 'created',
              'text-red-500': file.status === 'deleted',
              'text-yellow-500': file.status === 'modified',
            })}
          >
            {file.status === 'created' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
          </span>
          <span className="text-xs text-chatroom-text-primary truncate" title={file.filePath}>
            {basename(file.filePath)}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">{file.filePath}</span>
        </button>
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
}

const FileDiff = memo(function FileDiff({
  files,
  selectedFile,
  fullContent,
  isLoading,
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
    <div className="flex-1 overflow-hidden">
      <WorkspaceDiffViewer
        state={{ status: 'available', content: fileDiffContent, truncated: false, diffStat: { filesChanged: 1, insertions: 0, deletions: 0 } }}
        showFileList={false}
      />
    </div>
  );
});

/**
 * Extracts just the diff content for a single file section from the full diff.
 * Finds the file's header line and takes lines until the next file header.
 */
function buildFileDiffContent(section: FileDiffSection, fullContent: string): string {
  // Find the diff --git header for this file and extract through to the next
  const lines = fullContent.split('\n');
  const filePath = section.filePath;
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('diff --git') && (line.includes(`b/${filePath}`) || line.includes(`a/${filePath}`))) {
      if (startIdx === -1) {
        startIdx = i;
      } else {
        // Found the next file's section; stop here
        endIdx = i;
        break;
      }
    } else if (startIdx !== -1 && line.startsWith('diff --git')) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return '';
  return lines.slice(startIdx, endIdx).join('\n');
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const SourceControlPanel = memo(function SourceControlPanel({
  machineId,
  workingDir,
  chatroomId: _chatroomId,
}: SourceControlPanelProps) {
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

  // Selected file
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Auto-request on mount
  useEffect(() => {
    if (machineId && workingDir) {
      requestRecentCommits();
    }
  }, [machineId, workingDir, requestRecentCommits]);

  // Request working-tree diff when working-tree is selected
  useEffect(() => {
    if (activeSource?.type === 'working-tree' && fullDiffState.status === 'idle') {
      requestFullDiff();
    }
  }, [activeSource, fullDiffState.status, requestFullDiff]);

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
    } else {
      if (commitDetailState.status === 'available') {
        return parseDiff(commitDetailState.content);
      }
      return [];
    }
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
  }, []);

  const handleSelectCommit = useCallback((sha: string) => {
    setActiveSource({ type: 'commit', sha });
  }, []);

  const isDirty = gitState.status === 'available' && gitState.isDirty;
  const diffStat = gitState.status === 'available' ? gitState.diffStat : { filesChanged: 0, insertions: 0, deletions: 0 };
  const selectedSha = activeSource?.type === 'commit' ? activeSource.sha : null;

  const commits: GitCommit[] =
    recentCommitsState.status === 'available' ? recentCommitsState.commits : [];
  const hasMoreCommits =
    recentCommitsState.status === 'available' ? recentCommitsState.hasMoreCommits : false;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* ── Left Rail ──────────────────────────────────────────── */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-border overflow-hidden">
        {/* Diff summary */}
        <div className="shrink-0 border-b border-border">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Changes
          </div>
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
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
            History
          </div>
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

      {/* ── Middle: File List ────────────────────────────────────── */}
      <div className="w-[220px] shrink-0 flex flex-col border-r border-border overflow-hidden">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0 border-b border-border">
          Files
        </div>
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
              onSelectFile={setSelectedFile}
            />
          </div>
        )}
      </div>

      {/* ── Right: File Diff ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
          />
        )}
      </div>
    </div>
  );
});
