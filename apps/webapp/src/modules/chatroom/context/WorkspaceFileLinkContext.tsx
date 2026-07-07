'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface WorkspaceFileLinkContextValue {
  onOpenFile?: (filePath: string) => void;
}

const WorkspaceFileLinkContext = createContext<WorkspaceFileLinkContextValue>({});

export function WorkspaceFileLinkProvider({
  onOpenFile,
  children,
}: {
  onOpenFile?: (filePath: string) => void;
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
