'use client';

import {
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  ListX,
  Pencil,
  Trash2,
} from 'lucide-react';
import { memo, useId, type ReactNode } from 'react';

import { resolveFileDownloadAvailability } from './fileDownloadAvailability';
import type { WorkspaceFileCopyInfo, WorkspaceFileMenuProps } from './types';
import { useFileDownloadActions } from './useFileDownloadActions';
import { DOWNLOAD_FORMATS } from '../../lib/messageExport';
import { WorkspaceDropdownMenuItem } from '../components/WorkspaceDropdownMenuItem';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
  copyFullPathToClipboard,
  copyRelativePathToClipboard,
  type CopyResult,
} from '../utils/clipboard';

import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

interface Section {
  label?: string;
  description?: string;
  descriptionId?: string;
  items: ReactNode[];
}

export const WorkspaceFileMenuItems = memo(function WorkspaceFileMenuItems({
  state,
  handlers,
  visibility,
}: WorkspaceFileMenuProps) {
  const {
    relativePath,
    workingDir,
    nodeType,
    content,
    contentStatus,
    contentTruncated,
    contentDisabled = false,
    fileContentLabel = 'Copy File Content',
  } = state;

  const downloadReasonId = useId();

  // A success never shows text here. The host decides what, if anything, to show.
  const reportCopy = (
    copy: Promise<CopyResult>,
    info: WorkspaceFileCopyInfo = { truncated: false }
  ) => {
    void copy.then((result) => {
      if (result.ok) handlers.onCopied?.(info);
      else handlers.onCopyError?.(result.message);
    });
  };

  const sections: Section[] = [];

  // Workspace section
  const workspaceItems: ReactNode[] = [];
  if (visibility.newFile && handlers.onNewFile) {
    workspaceItems.push(
      <WorkspaceDropdownMenuItem key="new-file" icon={FilePlus} onSelect={handlers.onNewFile}>
        New File
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.newFolder && handlers.onNewFolder) {
    workspaceItems.push(
      <WorkspaceDropdownMenuItem key="new-folder" icon={FolderPlus} onSelect={handlers.onNewFolder}>
        New Folder
      </WorkspaceDropdownMenuItem>
    );
  }
  if (workspaceItems.length > 0) {
    sections.push({ items: workspaceItems });
  }

  // Path section
  const pathItems: ReactNode[] = [];
  if (visibility.copyFileName !== false) {
    pathItems.push(
      <WorkspaceDropdownMenuItem
        key="copy-name"
        icon={Copy}
        onSelect={() => reportCopy(copyFileNameToClipboard(relativePath))}
      >
        Copy File Name
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.copyRelativePath !== false) {
    pathItems.push(
      <WorkspaceDropdownMenuItem
        key="copy-relative"
        icon={Copy}
        onSelect={() => reportCopy(copyRelativePathToClipboard(relativePath))}
      >
        Copy Relative Path
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.copyFullPath !== false) {
    pathItems.push(
      <WorkspaceDropdownMenuItem
        key="copy-full"
        icon={Copy}
        onSelect={() => reportCopy(copyFullPathToClipboard(workingDir, relativePath))}
        disabled={!workingDir}
      >
        Copy Full Path
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.openInExplorer && handlers.onOpenInExplorer) {
    pathItems.push(
      <WorkspaceDropdownMenuItem
        key="open-explorer"
        icon={FolderOpen}
        onSelect={handlers.onOpenInExplorer}
      >
        Open in Explorer
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.openFileOnRemote && handlers.onOpenFileOnRemote) {
    pathItems.push(
      <WorkspaceDropdownMenuItem
        key="open-remote"
        icon={ExternalLink}
        onSelect={handlers.onOpenFileOnRemote}
      >
        Open File on Remote
      </WorkspaceDropdownMenuItem>
    );
  }
  if (pathItems.length > 0) {
    sections.push({ label: 'Path', items: pathItems });
  }

  // Content section
  const contentItems: ReactNode[] = [];
  if (visibility.copyFileContent) {
    contentItems.push(
      <WorkspaceDropdownMenuItem
        key="copy-content"
        icon={Copy}
        onSelect={() => {
          if (content && !contentDisabled) {
            reportCopy(copyFileContentToClipboard(content), {
              truncated: contentTruncated === true,
            });
          }
        }}
        disabled={contentDisabled || !content}
      >
        {fileContentLabel}
      </WorkspaceDropdownMenuItem>
    );
  }
  if (contentItems.length > 0) {
    sections.push({ label: 'Content', items: contentItems });
  }

  // Download section — shared availability gate and dispatcher, hidden for non-markdown files.
  const availability = resolveFileDownloadAvailability({
    filePath: relativePath,
    nodeType,
    status: contentStatus,
    content,
    truncated: contentTruncated,
  });
  const { busyFormat, run } = useFileDownloadActions({
    filePath: relativePath,
    workingDir,
    content: content ?? null,
    enabled: availability.kind === 'ready',
    onStart: handlers.onDownloadStart,
    onError: handlers.onDownloadError,
    onRequestClose: handlers.onRequestClose,
  });
  if (availability.kind !== 'hidden') {
    const reasonRef = availability.kind === 'disabled' ? downloadReasonId : undefined;
    sections.push({
      label: 'Download',
      descriptionId: downloadReasonId,
      description: availability.kind === 'disabled' ? availability.reason : undefined,
      items: DOWNLOAD_FORMATS.map((definition) => (
        <WorkspaceDropdownMenuItem
          key={definition.format}
          icon={Download}
          closeOnClick={false}
          disabled={busyFormat !== null || availability.kind !== 'ready'}
          aria-describedby={reasonRef}
          onSelect={() => run(definition.format)}
        >
          {busyFormat === definition.format && definition.busyLabel
            ? definition.busyLabel
            : definition.label}
        </WorkspaceDropdownMenuItem>
      )),
    });
  }

  // File section
  const fileItems: ReactNode[] = [];
  if (visibility.rename && handlers.onRename) {
    fileItems.push(
      <WorkspaceDropdownMenuItem key="rename" icon={Pencil} onSelect={handlers.onRename}>
        Rename
      </WorkspaceDropdownMenuItem>
    );
  }
  if (visibility.delete && handlers.onDelete) {
    fileItems.push(
      <WorkspaceDropdownMenuItem key="delete" icon={Trash2} onSelect={handlers.onDelete}>
        Delete
      </WorkspaceDropdownMenuItem>
    );
  }
  if (fileItems.length > 0) {
    sections.push({ items: fileItems });
  }

  // Tab section
  const tabItems: ReactNode[] = [];
  if (visibility.closeOthers && handlers.onCloseOthers) {
    tabItems.push(
      <WorkspaceDropdownMenuItem
        key="close-others"
        icon={ListX}
        onSelect={handlers.onCloseOthers}
        disabled={visibility.closeOthersDisabled}
      >
        Close Others
      </WorkspaceDropdownMenuItem>
    );
  }
  if (tabItems.length > 0) {
    sections.push({ items: tabItems });
  }

  return (
    <>
      {sections.map((section, index) => (
        <div key={index}>
          {index > 0 && <DropdownMenuSeparator />}
          {section.label && <DropdownMenuLabel>{section.label}</DropdownMenuLabel>}
          {section.description ? (
            <p
              id={section.descriptionId}
              data-testid="workspace-download-disabled-reason"
              className="max-w-[15rem] whitespace-normal px-2.5 pb-1 text-[11px] leading-snug text-chatroom-text-muted select-none"
            >
              {section.description}
            </p>
          ) : null}
          {section.items}
        </div>
      ))}
    </>
  );
});
