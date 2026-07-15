'use client';

import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  ListX,
  Pencil,
  Trash2,
} from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { DropdownMenuLabel, DropdownMenuSeparator } from '../../components/ui/dropdown-menu';
import { WorkspaceDropdownMenuItem } from '../components/WorkspaceDropdownMenuItem';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
  copyFullPathToClipboard,
  copyRelativePathToClipboard,
} from '../utils/clipboard';
import type { WorkspaceFileMenuProps } from './types';

interface Section {
  label?: string;
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
    content,
    contentTruncated = false,
    contentDisabled = false,
    fileContentLabel = 'Copy File Content',
  } = state;

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
        onSelect={() => void copyFileNameToClipboard(relativePath)}
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
        onSelect={() => void copyRelativePathToClipboard(relativePath)}
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
        onSelect={() => void copyFullPathToClipboard(workingDir, relativePath)}
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
            void copyFileContentToClipboard(content, { truncated: contentTruncated });
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
          {section.items}
        </div>
      ))}
    </>
  );
});
