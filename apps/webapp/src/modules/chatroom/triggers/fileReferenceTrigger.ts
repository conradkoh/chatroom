import type { FileEntry } from '../components/FileSelector/useFileSelector';
import type { TriggerDefinition } from '../hooks/useTriggerAutocomplete';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { encodeFileReference } from '@/lib/fileReference';

const MAX_DISPLAY = 24; // MAX_VISIBLE_ITEMS * 3

export function createFileReferenceTrigger(files: FileEntry[], prefix: string): TriggerDefinition<FileEntry> {
  return {
    triggerChar: '@',
    isValidPosition: (_textBeforeCursor, triggerIndex) => {
      if (triggerIndex === 0) return true;
      const charBefore = _textBeforeCursor[triggerIndex - 1];
      return charBefore === ' ' || charBefore === '\n' || charBefore === '\t';
    },
    isEnabled: () => files.length > 0,
    getResults: (query) => {
      if (!query) return files.slice(0, MAX_DISPLAY);
      return files
        .map((file) => ({ file, score: fuzzyMatch(query, file.path) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.file)
        .slice(0, MAX_DISPLAY);
    },
    serialize: (item) => {
      // Use the per-file workspaceId if available, otherwise skip encoding
      if (!item.workspaceId) return item.path;
      return encodeFileReference(item.workspaceId, item.path, prefix);
    },
    maxDisplayItems: MAX_DISPLAY,
  };
}
