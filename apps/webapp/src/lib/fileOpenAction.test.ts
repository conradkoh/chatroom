import { describe, expect, it } from 'vitest';

import { fileOpenAction } from './fileOpenAction';

describe('fileOpenAction', () => {
  it('opens pdfs in a new tab', () => {
    expect(fileOpenAction('pdf')).toBe('open-pdf');
  });

  it('downloads kinds with no inline preview', () => {
    expect(fileOpenAction('download')).toBe('download');
  });

  it('previews renderable kinds', () => {
    expect(fileOpenAction('image')).toBe('preview');
    expect(fileOpenAction('text')).toBe('preview');
    expect(fileOpenAction('markdown')).toBe('preview');
  });
});
