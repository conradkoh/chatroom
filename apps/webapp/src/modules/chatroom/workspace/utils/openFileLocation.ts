import type { FileLocation } from './fileLocation';

/** Returns a pending highlight when the location includes line numbers. */
export function pendingHighlightForLocation(location: FileLocation): FileLocation | null {
  if (!location.startLine) return null;
  return {
    filePath: location.filePath,
    startLine: location.startLine,
    endLine: location.endLine ?? location.startLine,
    highlightText: location.highlightText,
  };
}
