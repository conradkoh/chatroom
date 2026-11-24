import type {
  WorkspaceFileContentStatus,
  WorkspaceFileCopyInfo,
  WorkspaceFileMenuProps,
} from './types';

export interface FilePreviewMenuArgs {
  relativePath: string;
  workingDir: string | null;
  content: string | null;
  contentStatus: WorkspaceFileContentStatus;
  contentTruncated?: boolean;
  contentDisabled?: boolean;
  fileContentLabel?: string;
  showFileName?: boolean;
  showFileContent?: boolean;
  triggerVariant?: 'copy' | 'more';
  onOpenInExplorer?: () => void;
  onOpenFileOnRemote?: () => void;
  onCopyError?: (message: string) => void;
  onCopied?: (info: WorkspaceFileCopyInfo) => void;
  onDownloadStart?: () => void;
  onDownloadError?: (message: string) => void;
}

/**
 * One definition for both preview surfaces: the `...` menu and the action-bar right-click.
 * No clipboard logic lives here — only the state, handlers and visibility the shared
 * renderer needs.
 */
export function buildFilePreviewMenuProps(args: FilePreviewMenuArgs): WorkspaceFileMenuProps {
  const { showFileName = true, showFileContent = true } = args;
  return {
    state: {
      relativePath: args.relativePath,
      workingDir: args.workingDir,
      nodeType: 'file',
      content: args.content,
      contentStatus: args.contentStatus,
      contentTruncated: args.contentTruncated,
      contentDisabled: args.contentDisabled,
      fileContentLabel: args.fileContentLabel,
    },
    handlers: {
      onOpenInExplorer: args.onOpenInExplorer,
      onOpenFileOnRemote: args.onOpenFileOnRemote,
      onCopyError: args.onCopyError,
      onCopied: args.onCopied,
      onDownloadStart: args.onDownloadStart,
      onDownloadError: args.onDownloadError,
    },
    visibility: {
      copyFileName: showFileName,
      copyRelativePath: true,
      copyFullPath: true,
      copyFileContent: showFileContent,
      openInExplorer: !!args.onOpenInExplorer,
      openFileOnRemote: !!args.onOpenFileOnRemote,
    },
  };
}
