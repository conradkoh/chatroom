import { describe, expect, it, vi } from 'vitest';

import type { PathStatus } from './output-files.js';
import { findUnwritablePathMessage } from './writable-path.js';

/** pathStatus over a fixed path→status table; unknown paths are missing. */
function pathStatusFor(statuses: Record<string, PathStatus>) {
  return vi.fn(async (path: string): Promise<PathStatus> => statuses[path] ?? 'missing');
}

const OUT_PATH = '/tmp/generated/hero.glb';
const MANIFEST_PATH = '/tmp/generated/hero.glb.json';
const OVERWRITE_ADVICE = 'Pass --force to overwrite.';

describe('findUnwritablePathMessage', () => {
  it('refuses an existing file without --force', async () => {
    const deps = { pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) };
    const message = await findUnwritablePathMessage(
      deps,
      [{ path: OUT_PATH, label: '--out' }],
      false
    );
    expect(message).toBe(`--out already exists: ${OUT_PATH}. ${OVERWRITE_ADVICE}`);
  });

  it('allows an existing file with --force', async () => {
    const deps = { pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) };
    const message = await findUnwritablePathMessage(
      deps,
      [{ path: OUT_PATH, label: '--out' }],
      true
    );
    expect(message).toBeNull();
  });

  it('refuses a directory even with --force', async () => {
    const deps = { pathStatus: pathStatusFor({ [OUT_PATH]: 'directory' }) };
    const message = await findUnwritablePathMessage(
      deps,
      [{ path: OUT_PATH, label: '--out' }],
      true
    );
    expect(message).toBe(`--out is a directory: ${OUT_PATH}. Pass a file path.`);
  });

  it('allows a missing path and probes it once', async () => {
    const deps = { pathStatus: pathStatusFor({}) };
    const message = await findUnwritablePathMessage(
      deps,
      [{ path: OUT_PATH, label: '--out' }],
      false
    );
    expect(message).toBeNull();
    expect(deps.pathStatus).toHaveBeenCalledTimes(1);
    expect(deps.pathStatus).toHaveBeenCalledWith(OUT_PATH);
  });

  it('replaces the default advice with a custom hint', async () => {
    const customHint = 'Another run used this name; pass --force or wait.';
    const deps = { pathStatus: pathStatusFor({ [OUT_PATH]: 'file' }) };
    const message = await findUnwritablePathMessage(
      deps,
      [{ path: OUT_PATH, label: 'Package', hint: customHint }],
      false
    );
    expect(message).toBe(`Package already exists: ${OUT_PATH}. ${customHint}`);
    expect(message).not.toContain(OVERWRITE_ADVICE);
  });

  it('returns the first blocked target and stops probing after it', async () => {
    const deps = {
      pathStatus: pathStatusFor({ [OUT_PATH]: 'file', [MANIFEST_PATH]: 'file' }),
    };
    const message = await findUnwritablePathMessage(
      deps,
      [
        { path: OUT_PATH, label: '--out' },
        { path: MANIFEST_PATH, label: 'Manifest' },
      ],
      false
    );
    expect(message).toBe(`--out already exists: ${OUT_PATH}. ${OVERWRITE_ADVICE}`);
    expect(deps.pathStatus).toHaveBeenCalledTimes(1);
  });
});
