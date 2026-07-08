import type { FileDiffSection } from './diff-parser';

/**
 * Extracts just the diff content for a single file section from the full diff.
 * Finds the file's header line and takes lines until the next file header.
 */
// fallow-ignore-next-line complexity
export function buildFileDiffContent(section: FileDiffSection, fullContent: string): string {
  const lines = fullContent.split('\n');
  const filePath = section.filePath;
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (
      line.startsWith('diff --git') &&
      (line.includes(`b/${filePath}`) || line.includes(`a/${filePath}`))
    ) {
      if (startIdx === -1) {
        startIdx = i;
      } else {
        endIdx = i;
        break;
      }
    } else if (startIdx !== -1 && line.startsWith('diff --git')) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return '';
  return lines.slice(startIdx, endIdx).join('\n');
}
