export interface WorkspaceFileMenuState {
  relativePath: string;
  workingDir: string | null;
  nodeType?: 'file' | 'directory';
  content?: string | null;
  contentTruncated?: boolean;
  contentDisabled?: boolean;
  fileContentLabel?: string;
}

export interface WorkspaceFileMenuHandlers {
  onOpenInExplorer?: () => void;
  onOpenFileOnRemote?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCloseOthers?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
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
