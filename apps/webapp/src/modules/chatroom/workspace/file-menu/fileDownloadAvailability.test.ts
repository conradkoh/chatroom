import { describe, expect, it } from 'vitest';

import { resolveFileDownloadAvailability } from './fileDownloadAvailability';

describe('resolveFileDownloadAvailability', () => {
  it('hides the section for a directory node', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        nodeType: 'directory',
        content: 'body',
      })
    ).toEqual({ kind: 'hidden' });
  });

  it('hides the section for a non-markdown file', () => {
    expect(resolveFileDownloadAvailability({ filePath: 'src/a.ts', content: 'body' })).toEqual({
      kind: 'hidden',
    });
  });

  it.each(['README.md', 'page.mdx', 'guide.markdown'])(
    'is ready for %s with text content',
    (path) => {
      expect(resolveFileDownloadAvailability({ filePath: path, content: 'body' })).toEqual({
        kind: 'ready',
      });
    }
  );

  it('disables while the content is loading', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        status: 'loading',
        content: null,
      })
    ).toEqual({ kind: 'disabled', reason: 'Loading file content…' });
  });

  it('disables when the file is not found', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        status: 'not-found',
        content: null,
      })
    ).toEqual({ kind: 'disabled', reason: 'File not found.' });
  });

  it('disables a truncated file', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: 'body',
        truncated: true,
      })
    ).toEqual({ kind: 'disabled', reason: 'File is larger than the 500 KB preview limit.' });
  });

  it('prefers the truncation reason over a placeholder payload', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[Binary file]',
        truncated: true,
      })
    ).toEqual({ kind: 'disabled', reason: 'File is larger than the 500 KB preview limit.' });
  });

  it('maps the binary placeholder to the binary reason', () => {
    expect(
      resolveFileDownloadAvailability({ filePath: 'docs/README.md', content: '[Binary file]' })
    ).toEqual({ kind: 'disabled', reason: 'Binary files cannot be downloaded.' });
  });

  it('maps the not-found placeholder to the not-found reason', () => {
    expect(
      resolveFileDownloadAvailability({ filePath: 'docs/README.md', content: '[File not found]' })
    ).toEqual({ kind: 'disabled', reason: 'File not found.' });
  });

  it('maps the blocked placeholder to the blocked reason', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[File blocked: cannot open sensitive path]',
      })
    ).toEqual({ kind: 'disabled', reason: 'This file is blocked from reading.' });
  });

  it('maps the read-error placeholder to the read-error reason', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[Error reading file]',
      })
    ).toEqual({ kind: 'disabled', reason: 'Could not read this file.' });
  });

  it('maps the workspace placeholder to the workspace reason', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[Error: workspace not registered]',
      })
    ).toEqual({ kind: 'disabled', reason: 'The workspace is not available.' });
  });

  it('is ready for a markdown file whose text starts with "[File blocked" but is not a daemon placeholder', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[File blocked by review]\n\nBody',
      })
    ).toEqual({ kind: 'ready' });
  });

  it('disables the daemon blocked placeholder', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[File blocked: cannot open sensitive path in remote explorer]',
      })
    ).toEqual({ kind: 'disabled', reason: 'This file is blocked from reading.' });
  });

  it('is ready for a markdown file that starts with a daemon-like blocked line followed by body text', () => {
    expect(
      resolveFileDownloadAvailability({
        filePath: 'docs/README.md',
        content: '[File blocked: see the policy]\n\nBody',
      })
    ).toEqual({ kind: 'ready' });
  });

  it.each([
    ['[Binary file]', 'Binary files cannot be downloaded.'],
    ['[File not found]', 'File not found.'],
    ['[Error reading file]', 'Could not read this file.'],
    ['[Error: workspace not registered]', 'The workspace is not available.'],
  ])('maps the daemon placeholder %s to its reason', (content, reason) => {
    expect(resolveFileDownloadAvailability({ filePath: 'docs/README.md', content })).toEqual({
      kind: 'disabled',
      reason,
    });
  });

  it('disables when ready status has no content', () => {
    expect(resolveFileDownloadAvailability({ filePath: 'docs/README.md', content: null })).toEqual({
      kind: 'disabled',
      reason: 'File content is unavailable.',
    });
  });

  it('is ready for an empty file', () => {
    expect(resolveFileDownloadAvailability({ filePath: 'docs/README.md', content: '' })).toEqual({
      kind: 'ready',
    });
  });

  it('is ready for plain text content', () => {
    expect(
      resolveFileDownloadAvailability({ filePath: 'docs/README.md', content: 'file body' })
    ).toEqual({ kind: 'ready' });
  });
});
