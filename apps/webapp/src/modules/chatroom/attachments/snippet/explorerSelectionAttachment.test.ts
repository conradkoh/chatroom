import { describe, expect, it } from 'vitest';

import {
  createExplorerSnippetAttachment,
  renderInlineReference,
} from './explorerSelectionAttachment';

describe('createExplorerSnippetAttachment', () => {
  it('assigns attachment-reference-001 when none exist', () => {
    const att = createExplorerSnippetAttachment('./windsurfrules', '# Shadcn', []);
    expect(att.reference).toBe('attachment-reference-001');
  });

  it('increments past highest existing reference', () => {
    const att = createExplorerSnippetAttachment('./file.ts', 'content', [
      'attachment-reference-001',
      'attachment-reference-003',
    ]);
    expect(att.reference).toBe('attachment-reference-004');
  });

  it('trims selected content', () => {
    const att = createExplorerSnippetAttachment('./windsurfrules', '  # Shadcn\n  ', []);
    expect(att.fileSource).toBe('./windsurfrules');
    expect(att.selectedContent).toBe('# Shadcn');
  });
});

describe('renderInlineReference', () => {
  it('formats token exactly', () => {
    expect(renderInlineReference('attachment-reference-001')).toBe(
      '[attachment: attachment-reference-001]'
    );
  });
});
