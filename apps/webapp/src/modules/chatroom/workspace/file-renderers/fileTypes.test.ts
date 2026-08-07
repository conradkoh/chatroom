import { describe, expect, it } from 'vitest';

import { shouldOpenInEditableExplorerPane } from './fileTypes';

describe('shouldOpenInEditableExplorerPane', () => {
  it('opens markdown files in the editable pane', () => {
    expect(shouldOpenInEditableExplorerPane('README.md')).toBe(true);
    expect(shouldOpenInEditableExplorerPane('docs/guide.mdx')).toBe(true);
  });

  it('opens unknown text extensions in the editable pane', () => {
    expect(shouldOpenInEditableExplorerPane('config.jsonnet')).toBe(true);
    expect(shouldOpenInEditableExplorerPane('notes.txt')).toBe(true);
  });

  it('opens known code files in the highlighted read-only viewer', () => {
    expect(shouldOpenInEditableExplorerPane('main.go')).toBe(false);
    expect(shouldOpenInEditableExplorerPane('index.ts')).toBe(false);
    expect(shouldOpenInEditableExplorerPane('script.py')).toBe(false);
    expect(shouldOpenInEditableExplorerPane('style.css')).toBe(false);
  });
});
