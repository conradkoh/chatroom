'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { FileLocation } from '../workspace/utils/fileLocation';

interface WorkspaceFileLinkContextValue {
  onOpenFile?: (location: FileLocation) => void;
  /** When set, relative markdown links resolve against this file path. */
  baseFilePath?: string;
}

const WorkspaceFileLinkContext = createContext<WorkspaceFileLinkContextValue>({});

export function WorkspaceFileLinkProvider({
  onOpenFile,
  baseFilePath,
  children,
}: {
  onOpenFile?: (location: FileLocation) => void;
  baseFilePath?: string;
  children: ReactNode;
}) {
  const parent = useContext(WorkspaceFileLinkContext);
  return (
    <WorkspaceFileLinkContext.Provider
      value={{
        onOpenFile: onOpenFile ?? parent.onOpenFile,
        baseFilePath: baseFilePath ?? parent.baseFilePath,
      }}
    >
      {children}
    </WorkspaceFileLinkContext.Provider>
  );
}

export function useWorkspaceFileLink(): WorkspaceFileLinkContextValue {
  return useContext(WorkspaceFileLinkContext);
}
