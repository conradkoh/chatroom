'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { FileLocation } from '../workspace/utils/fileLocation';

interface WorkspaceFileLinkContextValue {
  onOpenFile?: (location: FileLocation) => void;
}

const WorkspaceFileLinkContext = createContext<WorkspaceFileLinkContextValue>({});

export function WorkspaceFileLinkProvider({
  onOpenFile,
  children,
}: {
  onOpenFile?: (location: FileLocation) => void;
  children: ReactNode;
}) {
  return (
    <WorkspaceFileLinkContext.Provider value={{ onOpenFile }}>
      {children}
    </WorkspaceFileLinkContext.Provider>
  );
}

export function useWorkspaceFileLink(): WorkspaceFileLinkContextValue {
  return useContext(WorkspaceFileLinkContext);
}
