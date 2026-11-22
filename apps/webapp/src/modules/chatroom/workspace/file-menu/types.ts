export interface WorkspaceFileMenuState {
  relativePath: string;
  workingDir: string | null;
  nodeType?: 'file' | 'directory';
  content?: string | null;
  /** True when `content` is a truncated copy of the file. Read only by the file-content copy item. */
  contentTruncated?: boolean;
  contentDisabled?: boolean;
  fileContentLabel?: string;
}

export type WorkspaceFileMenuContentState = Pick<
  WorkspaceFileMenuState,
  'content' | 'contentTruncated' | 'contentDisabled' | 'fileContentLabel'
>;

/** What a successful copy reports. `truncated` is true only when the copied file content was cut short. */
export interface WorkspaceFileCopyInfo {
  truncated: boolean;
}

export interface WorkspaceFileMenuHandlers {
  onOpenInExplorer?: () => void;
  onOpenFileOnRemote?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCloseOthers?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  /** Called after a copy item succeeds, with what was copied. Hosts may show nothing. Never add copy text here. */
  onCopied?: (info: WorkspaceFileCopyInfo) => void;
  /** Called with the failure message when a copy item fails. Undefined means the failure is not shown. */
  onCopyError?: (message: string) => void;
}

export interface WorkspaceFileMenuVisibility {
  copyFileName?: boolean;
  copyRelativePath?: boolean;
  copyFullPath?: boolean;
  copyFileContent?: boolean;
  openInExplorer?: boolean;
  openFileOnRemote?: boolean;
  rename?: boolean;
  delete?: boolean;
  closeOthers?: boolean;
  closeOthersDisabled?: boolean;
  newFile?: boolean;
  newFolder?: boolean;
}

export interface WorkspaceFileMenuProps {
  state: WorkspaceFileMenuState;
  handlers: WorkspaceFileMenuHandlers;
  visibility: WorkspaceFileMenuVisibility;
}
