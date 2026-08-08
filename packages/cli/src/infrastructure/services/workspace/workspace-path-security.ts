import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

export type PathResult = { ok: true; absolutePath: string } | { ok: false; error: string };

// fallow-ignore-next-line unused-export
export function validateRelativePathSegments(filePath: string): PathResult | { ok: true } {
  if (filePath.includes('\0')) return { ok: false, error: 'Invalid file path' };
  if (filePath.includes('..')) return { ok: false, error: 'Invalid file path' };
  if (filePath.startsWith('/')) return { ok: false, error: 'Invalid file path' };
  return { ok: true };
}

/** Robust containment — not just startsWith. */
export function isPathInsideRoot(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath);
  if (rel === '') return true;
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

function assertContained(workspaceRoot: string, targetPath: string): PathResult | { ok: true } {
  if (!isPathInsideRoot(workspaceRoot, targetPath)) {
    return { ok: false, error: 'Path escapes workspace' };
  }
  return { ok: true };
}

// fallow-ignore-next-line complexity
async function resolveNonExistentTarget(
  workspaceRoot: string,
  candidate: string
): Promise<PathResult> {
  let current = dirname(candidate);
  for (;;) {
    try {
      const ancestorReal = await realpath(current);
      const ancestorCheck = assertContained(workspaceRoot, ancestorReal);
      if (!ancestorCheck.ok) return ancestorCheck;
      const suffix = relative(current, candidate);
      const resolved = resolve(ancestorReal, suffix);
      const resolvedCheck = assertContained(workspaceRoot, resolved);
      if (!resolvedCheck.ok) return resolvedCheck;
      return { ok: true, absolutePath: resolved };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        return { ok: false, error: 'Invalid file path' };
      }
      const parent = dirname(current);
      if (parent === current) {
        return { ok: false, error: 'Path escapes workspace' };
      }
      current = parent;
    }
  }
}

/**
 * Resolve filePath under workingDir with realpath on workspace root.
 * For non-existent targets (create/mkdir), realpath parent dir when possible.
 */
// fallow-ignore-next-line complexity
export async function resolvePathWithinWorkspace(
  workingDir: string,
  filePath: string
): Promise<PathResult> {
  const basic = validateRelativePathSegments(filePath);
  if (!basic.ok) return basic;

  let workspaceRoot: string;
  try {
    workspaceRoot = await realpath(resolve(workingDir));
  } catch {
    return { ok: false, error: 'Working directory not found' };
  }

  const candidate = resolve(workspaceRoot, filePath);
  if (!isPathInsideRoot(workspaceRoot, candidate)) {
    return { ok: false, error: 'Path escapes workspace' };
  }

  try {
    const resolved = await realpath(candidate);
    const containment = assertContained(workspaceRoot, resolved);
    if (!containment.ok) return containment;
    return { ok: true, absolutePath: resolved };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      return { ok: false, error: 'Invalid file path' };
    }

    return resolveNonExistentTarget(workspaceRoot, candidate);
  }
}

export function gunzipBase64Payload(
  base64: string,
  maxBytes: number
): { ok: true; content: Buffer } | { ok: false; errorMessage: string } {
  let compressed: Buffer;
  try {
    compressed = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, errorMessage: 'Missing file data' };
  }

  if (compressed.length > maxBytes * 10) {
    return { ok: false, errorMessage: 'File content too large' };
  }

  try {
    const content = gunzipSync(compressed, { maxOutputLength: maxBytes });
    if (content.length > maxBytes) {
      return { ok: false, errorMessage: 'File content too large' };
    }
    return { ok: true, content };
  } catch {
    return { ok: false, errorMessage: 'File content too large' };
  }
}
