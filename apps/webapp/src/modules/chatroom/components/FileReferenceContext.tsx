'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface FileReferenceContextValue {
  onClickFileReference: ((filePath: string) => void) | null;
}

const FileReferenceContext = createContext<FileReferenceContextValue>({
  onClickFileReference: null,
});

export function FileReferenceProvider({
  onClickFileReference,
  children,
}: {
  onClickFileReference: (filePath: string) => void;
  children: ReactNode;
}) {
  return (
    <FileReferenceContext.Provider value={{ onClickFileReference }}>
      {children}
    </FileReferenceContext.Provider>
  );
}

/**
 * Returns the file reference click handler from the nearest FileReferenceProvider.
 * Returns null if no provider is present — callers should treat chips as static in that case.
 */
export function useFileReferenceClick() {
  return useContext(FileReferenceContext).onClickFileReference;
}
