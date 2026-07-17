'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import type { FileLocation } from '../workspace/utils/fileLocation';

interface PendingFileHighlightContextValue {
  pendingHighlight: FileLocation | null;
  setPendingHighlight: (location: FileLocation | null) => void;
  peekHighlightForFile: (filePath: string) => FileLocation | null;
  consumeHighlightForFile: (filePath: string) => FileLocation | null;
}

const PendingFileHighlightContext = createContext<PendingFileHighlightContextValue>({
  pendingHighlight: null,
  setPendingHighlight: () => undefined,
  peekHighlightForFile: () => null,
  consumeHighlightForFile: () => null,
});

export function PendingFileHighlightProvider({
  children,
  value,
  onChange,
}: {
  children: ReactNode;
  value?: FileLocation | null;
  onChange?: (location: FileLocation | null) => void;
}) {
  const [internalHighlight, setInternalHighlight] = useState<FileLocation | null>(null);
  const pendingHighlight = value !== undefined ? value : internalHighlight;
  const setPendingHighlight = onChange ?? setInternalHighlight;

  const peekHighlightForFile = useCallback(
    (filePath: string): FileLocation | null => {
      if (!pendingHighlight || pendingHighlight.filePath !== filePath) return null;
      return pendingHighlight;
    },
    [pendingHighlight]
  );

  const consumeHighlightForFile = useCallback(
    (filePath: string): FileLocation | null => {
      const match = peekHighlightForFile(filePath);
      if (match) {
        setPendingHighlight(null);
      }
      return match;
    },
    [peekHighlightForFile, setPendingHighlight]
  );

  return (
    <PendingFileHighlightContext.Provider
      value={{
        pendingHighlight,
        setPendingHighlight,
        peekHighlightForFile,
        consumeHighlightForFile,
      }}
    >
      {children}
    </PendingFileHighlightContext.Provider>
  );
}

export function usePendingFileHighlight(): PendingFileHighlightContextValue {
  return useContext(PendingFileHighlightContext);
}
