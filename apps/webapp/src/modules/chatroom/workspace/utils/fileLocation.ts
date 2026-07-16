const WORKSPACE_HREF_PREFIX = 'workspace:';
const LINE_SUFFIX_RE = /:(\d+)(?:-(\d+))?$/;
const FRAGMENT_RE = /^L(\d+)(?:-L(\d+))?$/i;

function normalizePath(path: string): string {
  const withoutProtocol = path.startsWith('file://') ? path.slice('file://'.length) : path;
  const trimmed = withoutProtocol.replace(/^\/+/, '');
  return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
}

export interface FileLocation {
  filePath: string;
  startLine?: number;
  endLine?: number;
  highlightText?: string;
}
function stripLineSuffix(text: string): {
  path: string;
  startLine?: number;
  endLine?: number;
} {
  const match = LINE_SUFFIX_RE.exec(text);
  if (!match) return { path: text };

  const path = text.slice(0, match.index);
  const startLine = Number.parseInt(match[1], 10);
  const endLine = match[2] ? Number.parseInt(match[2], 10) : startLine;
  return { path, startLine, endLine };
}

export function serializeFileLocationHref(loc: FileLocation): string {
  if (!loc.startLine) {
    return loc.filePath;
  }

  const start = loc.startLine;
  const end = loc.endLine ?? start;
  const fragment = start === end ? `L${start}` : `L${start}-L${end}`;
  return `${loc.filePath}#${fragment}`;
}

function applyLineFragment(loc: FileLocation, fragment: string): FileLocation {
  const fragMatch = FRAGMENT_RE.exec(fragment);
  if (!fragMatch) return loc;
  return {
    ...loc,
    startLine: Number.parseInt(fragMatch[1], 10),
    endLine: fragMatch[2] ? Number.parseInt(fragMatch[2], 10) : Number.parseInt(fragMatch[1], 10),
  };
}

// fallow-ignore-next-line complexity
export function parseFileLocation(href: string): FileLocation | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(WORKSPACE_HREF_PREFIX)) {
    return parseWorkspaceHref(trimmed);
  }

  const hashIdx = trimmed.indexOf('#');
  if (hashIdx >= 0) {
    const pathPart = trimmed.slice(0, hashIdx);
    const fragment = trimmed.slice(hashIdx + 1);
    const filePath = normalizePath(pathPart);
    if (!filePath || !filePath.includes('/')) return null;
    return applyLineFragment({ filePath }, fragment);
  }

  const { path, startLine, endLine } = stripLineSuffix(trimmed);
  const filePath = normalizePath(path);
  if (!filePath || !filePath.includes('/')) return null;

  const loc: FileLocation = { filePath };
  if (startLine !== undefined) {
    loc.startLine = startLine;
    loc.endLine = endLine;
  }
  return loc;
}

// fallow-ignore-next-line complexity
function parseWorkspaceHref(href: string): FileLocation | null {
  const rest = href.slice(WORKSPACE_HREF_PREFIX.length);
  const hashIdx = rest.indexOf('#');
  const pathPart = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const fragment = hashIdx >= 0 ? rest.slice(hashIdx + 1) : '';

  const filePath = normalizePath(pathPart);
  if (!filePath) return null;

  const loc: FileLocation = { filePath };
  if (fragment) {
    return applyLineFragment(loc, fragment);
  }
  return loc;
}
