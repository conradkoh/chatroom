'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, Copy, Loader2, ChevronRight, ChevronDown, FolderIcon, Menu, ChevronsDownUp, Search, Eye, Code2, Files } from 'lucide-react';
import { isMarkdownFile, isCsvFile, getDefaultViewMode, type FileViewMode, MarkdownRenderer, CsvTableRenderer } from '../../workspace/file-renderers';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { FileTypeIcon } from './fileIcons';
import { isBinaryFile } from './binaryDetection';
import type { FileEntry } from './useFileSelector';
import { proseClassNames } from '../markdown-utils';

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
  /** Called when user wants to open the file in the explorer view */
  onOpenInExplorer?: (filePath: string) => void;
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

  const [filter, setFilter] = useState('');

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

  const handleCollapseAll = useCallback(() => {
    setExpandedDirs(new Set<string>());
  }, []);

  // Filter tree: when filter is active, show only matching files and their parent dirs
  const filteredTree = useMemo(() => {
    if (!filter.trim()) return tree;
    const lowerFilter = filter.toLowerCase();

    function filterNode(node: TreeNode): TreeNode | null {
      if (node.type === 'file') {
        return node.name.toLowerCase().includes(lowerFilter) ? node : null;
      }
      // Directory: include if any child matches
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null);
      if (filteredChildren.length === 0) return null;
      return { ...node, children: filteredChildren };
    }

    return tree.map(filterNode).filter((n): n is TreeNode => n !== null);
  }, [tree, filter]);

  // When filter is active, auto-expand all directories to show matches
  const effectiveExpandedDirs = useMemo(() => {
    if (!filter.trim()) return expandedDirs;
    const allDirs = new Set<string>();
    function collectDirs(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.type === 'directory') {
          allDirs.add(node.path);
          collectDirs(node.children);
        }
      }
    }
    collectDirs(filteredTree);
    return allDirs;
  }, [filter, expandedDirs, filteredTree]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-chatroom-border shrink-0">
        <div className="flex-1 flex items-center gap-1.5 bg-chatroom-bg-hover/50 rounded px-2 py-1">
          <Search className="h-3 w-3 text-chatroom-text-muted shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="flex-1 bg-transparent text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none min-w-0"
          />
        </div>
        <button
          onClick={handleCollapseAll}
          className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1 shrink-0"
          title="Collapse all folders"
        >
          <ChevronsDownUp className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Tree */}
      <div className="overflow-y-auto flex-1 py-1">
        {filteredTree.length === 0 && filter.trim() ? (
          <div className="px-3 py-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              NO MATCHING FILES
            </span>
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              expandedDirs={effectiveExpandedDirs}
              onToggleDir={handleToggleDir}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
});

// ─── File Content Panel ─────────────────────────────────────────────────────

const FileContentPanel = memo(function FileContentPanel({
  filePath,
  machineId,
  workingDir,
  viewMode,
}: {
  filePath: string | null;
  machineId: string | null;
  workingDir: string | null;
  viewMode: FileViewMode;
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
      {viewMode === 'preview' && filePath && isMarkdownFile(filePath) ? (
        /* Rendered markdown preview */
        <div className="flex-1 p-6 overflow-auto">
          <MarkdownRenderer content={contentResult.content} className={proseClassNames} />
        </div>
      ) : viewMode === 'table' && filePath && isCsvFile(filePath) ? (
        /* CSV table view */
        <div className="flex-1 p-4 overflow-auto">
          <CsvTableRenderer content={contentResult.content} />
        </div>
      ) : (
        /* Raw source with line numbers */
        <>
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
        </>
      )}
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
  onOpenInExplorer,
}: FilePreviewDialogProps) {
  const isOpen = !!filePath;

  const [copied, setCopied] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [viewMode, setViewMode] = useState<FileViewMode>(() => getDefaultViewMode(filePath ?? ''));

  // Reset view mode when file changes
  useEffect(() => {
    setViewMode(getDefaultViewMode(filePath ?? ''));
  }, [filePath]);

  const isMarkdown = filePath ? isMarkdownFile(filePath) : false;
  const isCsv = filePath ? isCsvFile(filePath) : false;
  const hasToggle = isMarkdown || isCsv;

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [filePath]);

  // Close mobile tree when selecting a file
  const handleMobileSelectFile = useCallback((path: string) => {
    onSelectFile(path);
    setMobileTreeOpen(false);
  }, [onSelectFile]);

  // Fetch content result for header metadata
  const contentResult = useSessionQuery(
    api.workspaceFiles.getFileContent,
    machineId && workingDir && filePath
      ? { machineId, workingDir, filePath }
      : 'skip'
  );

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[96vw]" className="sm:!h-[92vh]">
      {/* Left Panel: File Tree (desktop) */}
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
            {/* Mobile tree toggle button */}
            <button
              onClick={() => setMobileTreeOpen((prev) => !prev)}
              className="sm:hidden text-chatroom-text-muted hover:text-chatroom-text-primary p-1 shrink-0"
              title="Browse files"
            >
              <Menu className="h-4 w-4" />
            </button>
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
            {hasToggle && (
              <button
                onClick={() => setViewMode(prev => prev === 'source' ? (isMarkdown ? 'preview' : 'table') : 'source')}
                className={`p-1 shrink-0 transition-colors ${
                  viewMode !== 'source'
                    ? 'text-chatroom-accent'
                    : 'text-chatroom-text-muted hover:text-chatroom-text-primary'
                }`}
                title={viewMode === 'source' ? (isMarkdown ? 'Preview markdown' : 'View as table') : 'Show source'}
              >
                {viewMode === 'source' ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
              </button>
            )}
            {onOpenInExplorer && filePath && (
              <button
                onClick={() => {
                  onOpenInExplorer(filePath);
                  onClose();
                }}
                className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1 shrink-0"
                title="Open in Explorer"
              >
                <Files className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </FixedModalHeader>
        <div className="flex-1 flex min-h-0 relative">
          {/* Mobile file tree overlay */}
          {mobileTreeOpen && (
            <div className="sm:hidden absolute inset-0 z-10 bg-chatroom-bg-primary border-r border-chatroom-border overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-chatroom-border">
                <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">Files</span>
                <button
                  onClick={() => setMobileTreeOpen(false)}
                  className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <FileTreeSidebar
                files={files}
                selectedPath={filePath}
                onSelectFile={handleMobileSelectFile}
              />
            </div>
          )}
          <FixedModalBody>
            <FileContentPanel
              filePath={filePath}
              machineId={machineId}
              workingDir={workingDir}
              viewMode={viewMode}
            />
          </FixedModalBody>
        </div>
      </FixedModalContent>
    </FixedModal>
  );
});
