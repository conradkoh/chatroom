/**
 * Parse and format @ file-reference queries with optional quoted path segments.
 */

/** Extract the raw query after `@`. Returns null when whitespace appears outside quotes. */
// fallow-ignore-next-line complexity
export function extractFileReferenceQuery(
  textBeforeCursor: string,
  triggerIndex: number
): string | null {
  const afterAt = textBeforeCursor.slice(triggerIndex + 1);
  if (afterAt.length === 0) return '';

  let i = 0;
  while (i < afterAt.length) {
    const ch = afterAt[i];
    if (ch === '"') {
      i++;
      while (i < afterAt.length && afterAt[i] !== '"') {
        i++;
      }
      if (i < afterAt.length) i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      return null;
    }
    i++;
  }

  return afterAt;
}

// fallow-ignore-next-line complexity
function tokenizePathQuery(query: string): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < query.length) {
    if (query[i] === '/') {
      i++;
      continue;
    }

    if (query[i] === '"') {
      i++;
      let segment = '';
      while (i < query.length && query[i] !== '"') {
        segment += query[i];
        i++;
      }
      if (i < query.length) i++;
      segments.push(segment);
      continue;
    }

    let segment = '';
    while (i < query.length && query[i] !== '/' && query[i] !== '"') {
      segment += query[i];
      i++;
    }
    if (segment) segments.push(segment);
  }

  return segments;
}

/** Split a file-reference query into a navigated folder prefix and remaining search term. */
// fallow-ignore-next-line complexity
export function parseFileReferenceQuery(query: string): { prefix: string; searchTerm: string } {
  if (!query) return { prefix: '', searchTerm: '' };

  const endsWithSlash = query.endsWith('/');
  const segments = tokenizePathQuery(query);

  if (segments.length === 0) return { prefix: '', searchTerm: '' };

  if (endsWithSlash) {
    return { prefix: `${segments.join('/')}/`, searchTerm: '' };
  }

  if (segments.length === 1) {
    const searchTerm = segments[0];
    if (!searchTerm) return { prefix: '', searchTerm: '' };
    return { prefix: '', searchTerm };
  }

  const searchTerm = segments.pop();
  if (!searchTerm) return { prefix: '', searchTerm: '' };
  return { prefix: `${segments.join('/')}/`, searchTerm };
}

function formatPathSegment(segment: string): string {
  return /\s/.test(segment) ? `"${segment}"` : segment;
}

/** Format a directory path for insertion after `@` during folder drill-down. */
export function formatFileReferenceDrillDown(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return `${segments.map(formatPathSegment).join('/')}/`;
}

/** Format a finalized file reference (without the leading `@`). */
export function formatFileReferenceFinal(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : path;
}
