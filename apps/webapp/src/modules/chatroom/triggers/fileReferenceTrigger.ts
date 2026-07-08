import type { FileEntry } from '../components/FileSelector/useFileSelector';
import type { TriggerDefinition } from '../hooks/useTriggerAutocomplete';

import { fuzzyMatch } from '@/lib/fuzzyMatch';

const MAX_DISPLAY = 24; // MAX_VISIBLE_ITEMS * 3

/** Serialize a file or directory entry for insertion after @ trigger. */
export function serializeFileReferencePath(item: FileEntry): string {
  if (item.type === 'directory') {
    return item.path.endsWith('/') ? item.path : `${item.path}/`;
  }
  return item.path;
}

export function createFileReferenceTrigger(
  files: FileEntry[],
  options?: {
    onActivate?: () => void;
    /** When true, @ is available even before the first file-search result arrives. */
    hasWorkspace?: boolean;
  }
): TriggerDefinition<FileEntry> {
  const onActivate = options?.onActivate;
  const hasWorkspace = options?.hasWorkspace ?? false;

  return {
    triggerChar: '@',
    isValidPosition: (_textBeforeCursor, triggerIndex) => {
      if (triggerIndex === 0) return true;
      const charBefore = _textBeforeCursor[triggerIndex - 1];
      return charBefore === ' ' || charBefore === '\n' || charBefore === '\t';
    },
    isEnabled: () => hasWorkspace || files.length > 0,
    getResults: (query) => {
      if (!query) return files.slice(0, MAX_DISPLAY);
      return files
        .map((file) => ({ file, score: fuzzyMatch(query, file.path) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.file)
        .slice(0, MAX_DISPLAY);
    },
    serialize: serializeFileReferencePath,
    onActivate,
    maxDisplayItems: MAX_DISPLAY,
  };
}
