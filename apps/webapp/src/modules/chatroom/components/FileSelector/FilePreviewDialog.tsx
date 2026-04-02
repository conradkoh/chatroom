'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, Copy, Loader2, ChevronRight, ChevronDown, FolderIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { FileTypeIcon } from './fileIcons';
import { isBinaryFile } from './binaryDetection';
import type { FileEntry } from './useFileSelector';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';

interface FilePreviewDialogProps {
  filePath: string | null;
  machineId: string | null;
  workingDir: string | null;
  onClose: () => void;
  /** All files from the workspace for the sidebar tree */
  files: FileEntry[];
  /** Callback when a different file is selected from the sidebar */
  onSelectFile: (filePath: string) => void;
}

// ─── Tree Node Types ────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: TreeNode[];
}

/** Build a tree structure from flat file entries */
function buildFileTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  // Sort files so directories come first, then alphabetically
  const sorted = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;

      let existing = dirMap.get(partPath);
      if (!existing) {
        existing = {
          name: parts[i],
          path: partPath,
          type: isLast ? file.type : 'directory',
          children: [],
        };
        dirMap.set(partPath, existing);
        currentLevel.push(existing);
      }
      currentLevel = existing.children;
    }
  }

  return root;
}

/** Sort tree nodes: directories first, then files, alphabetically within each */
function sortTree(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({
      ...node,
      children: sortTree(node.children),
    }));
}

// ─── Tree Item Component ────────────────────────────────────────────────────

const TreeItem = memo(function TreeItem({
  node,
  depth,
  selectedPath,
  expandedDirs,
  onToggleDir,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = node.path === selectedPath;
  const isDir = node.type === 'directory';
  const paddingLeft = 8 + depth * 16;

  return (
    <>
      <button
        className={`w-full flex items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors ${
          isSelected
            ? 'bg-chatroom-accent/10 text-chatroom-accent'
            : 'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
        }`}
        style={{ paddingLeft }}
        onClick={() => {
          if (isDir) {
            onToggleDir(node.path);
          } else {
            onSelectFile(node.path);
          }
        }}
      >
        {isDir ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" /> // spacer for alignment
        )}
        {isDir ? (
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-chatroom-text-muted" />
        ) : (
          <FileTypeIcon path={node.path} className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate font-mono">{node.name}</span>
      </button>
      {isDir && isExpanded && node.children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
        />
      ))}
    </>
  );
});

// ─── File Tree Sidebar ──────────────────────────────────────────────────────

const FileTreeSidebar = memo(function FileTreeSidebar({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: FileEntry[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const tree = useMemo(() => sortTree(buildFileTree(files)), [files]);

  // Auto-expand directories that contain the selected file
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    if (!selectedPath) return new Set<string>();
    const parts = selectedPath.split('/');
    const dirs = new Set<string>();
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
    return dirs;
  });

  // When selected file changes, expand its parent directories
  useEffect(() => {
    if (!selectedPath) return;
    const parts = selectedPath.split('/');
    const dirs = new Set<string>();
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
  }, [selectedPath]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="overflow-y-auto py-1">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedDirs={expandedDirs}
          onToggleDir={handleToggleDir}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
});

// ─── File Content Panel ─────────────────────────────────────────────────────

const FileContentPanel = memo(function FileContentPanel({
  filePath,
  machineId,
  workingDir,
}: {
  filePath: string | null;
  machineId: string | null;
  workingDir: string | null;
}) {
  // Fetch cached content
  const contentResult = useSessionQuery(
    api.workspaceFiles.getFileContent,
    machineId && workingDir && filePath
      ? { machineId, workingDir, filePath }
      : 'skip'
  );

  // Request content mutation (triggers daemon to fetch)
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  // When file is selected, request its content
  useEffect(() => {
    if (filePath && machineId && workingDir) {
      requestContent({ machineId, workingDir, filePath }).catch(() => {});
    }
  }, [filePath, machineId, workingDir, requestContent]);

  const isBinary = filePath ? isBinaryFile(filePath) : false;

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
          SELECT A FILE TO PREVIEW
        </span>
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
          FILE FORMAT UNSUPPORTED
        </span>
        <span className="text-[10px] font-mono text-chatroom-text-muted">{filePath}</span>
      </div>
    );
  }

  if (!contentResult) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex overflow-auto h-full">
      {/* Line numbers */}
      <div className="sticky left-0 select-none border-r border-chatroom-border bg-chatroom-bg-primary py-4 pr-3 pl-2 text-right w-[3.5rem] shrink-0">
        {contentResult.content.split('\n').map((_: string, i: number) => (
          <div key={i} className="text-[10px] font-mono text-chatroom-text-muted leading-relaxed">
            {i + 1}
          </div>
        ))}
      </div>
      {/* Content */}
      <pre className="flex-1 p-4 text-[13px] font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto leading-relaxed">
        {contentResult.content}
      </pre>
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

export const FilePreviewDialog = memo(function FilePreviewDialog({
  filePath,
  machineId,
  workingDir,
  onClose,
  files,
  onSelectFile,
}: FilePreviewDialogProps) {
  const isOpen = !!filePath;

  const [copied, setCopied] = useState(false);

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [filePath]);

  // Fetch content result for header metadata
  const contentResult = useSessionQuery(
    api.workspaceFiles.getFileContent,
    machineId && workingDir && filePath
      ? { machineId, workingDir, filePath }
      : 'skip'
  );

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-6xl">
      {/* Left Panel: File Tree */}
      <FixedModalSidebar className="w-64 hidden sm:flex">
        <FixedModalHeader>
          <FixedModalTitle>Files</FixedModalTitle>
        </FixedModalHeader>
        <div className="flex-1 overflow-y-auto">
          <FileTreeSidebar
            files={files}
            selectedPath={filePath}
            onSelectFile={onSelectFile}
          />
        </div>
      </FixedModalSidebar>

      {/* Right Panel: File Content */}
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {filePath && (
              <FileTypeIcon path={filePath} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted font-mono truncate">
              {filePath}
            </span>
            {contentResult?.truncated && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
                TRUNCATED
              </span>
            )}
            {contentResult && (
              <span className="text-[10px] font-mono text-chatroom-text-muted tabular-nums shrink-0">
                {contentResult.content.split('\n').length} lines
              </span>
            )}
            <button
              onClick={handleCopyPath}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1 shrink-0"
              title="Copy file path"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          <FileContentPanel
            filePath={filePath}
            machineId={machineId}
            workingDir={workingDir}
          />
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
