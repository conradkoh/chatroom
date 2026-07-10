import {
  extractFileReferenceQuery,
  formatFileReferenceDrillDown,
  formatFileReferenceFinal,
  parseFileReferenceQuery,
} from './fileReferenceQuery';
import type { FileEntry } from '../components/FileSelector/useFileSelector';
import type { TriggerDefinition } from '../hooks/useTriggerAutocomplete';

import { fuzzyMatch } from '@/lib/fuzzyMatch';
import { getFileName, getParentDir } from '@/lib/pathUtils';

const MAX_DISPLAY = 24; // MAX_VISIBLE_ITEMS * 3

/** Serialize a file entry for final insertion (replaces the @ trigger). */
export function serializeFileReferencePath(item: FileEntry): string {
  return formatFileReferenceFinal(item.path);
}

/** Serialize a directory for drill-down after @ (keeps the trigger active). */
function serializeFileReferenceDrillDown(item: FileEntry): string {
  return formatFileReferenceDrillDown(item.path);
}

function getScopedFileResults(files: FileEntry[], query: string): FileEntry[] {
  const { prefix, searchTerm } = parseFileReferenceQuery(query);

  let candidates = files;
  if (prefix) {
    const parentPath = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    candidates = files.filter((file) => getParentDir(file.path) === parentPath);
  }

  if (!searchTerm) return candidates.slice(0, MAX_DISPLAY);

  return candidates
    .map((file) => ({
      file,
      score: fuzzyMatch(searchTerm, prefix ? getFileName(file.path) : file.path),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.file)
    .slice(0, MAX_DISPLAY);
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
    extractQuery: extractFileReferenceQuery,
    getResults: (query) => {
      if (!query) return files.slice(0, MAX_DISPLAY);
      return getScopedFileResults(files, query);
    },
    serialize: serializeFileReferencePath,
    serializeDrillDown: serializeFileReferenceDrillDown,
    shouldKeepOpen: (item) => item.type === 'directory',
    onActivate,
    maxDisplayItems: MAX_DISPLAY,
  };
}
