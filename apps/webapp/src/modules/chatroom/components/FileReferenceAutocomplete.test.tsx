import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileReferenceAutocomplete } from './FileReferenceAutocomplete';
import type { FileEntry } from './FileSelector/useFileSelector';

const files: FileEntry[] = [
  { path: 'src/a.ts', type: 'file' },
  { path: 'src/b.ts', type: 'file' },
  { path: 'src/c.ts', type: 'file' },
];

function isSelectedItem(el: Element): boolean {
  return el.className.split(/\s+/).includes('bg-chatroom-bg-hover');
}

describe('FileReferenceAutocomplete', () => {
  it('highlights the selected item and uses unique React keys per result', () => {
    const onSelect = vi.fn();
    const onHoverItem = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <FileReferenceAutocomplete
        results={files}
        selectedIndex={0}
        position={{ top: 8, left: 0 }}
        onSelect={onSelect}
        onHoverItem={onHoverItem}
        visible
      />
    );

    const items = () => Array.from(document.querySelectorAll('[data-autocomplete-item]'));
    expect(items()).toHaveLength(3);
    expect(isSelectedItem(items()[0]!)).toBe(true);
    expect(isSelectedItem(items()[1]!)).toBe(false);

    rerender(
      <FileReferenceAutocomplete
        results={files}
        selectedIndex={2}
        position={{ top: 8, left: 0 }}
        onSelect={onSelect}
        onHoverItem={onHoverItem}
        visible
      />
    );

    expect(isSelectedItem(items()[2]!)).toBe(true);

    const duplicateKeyErrors = consoleError.mock.calls.filter(([msg]) =>
      String(msg).includes('Encountered two children with the same key')
    );
    expect(duplicateKeyErrors).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('calls onHoverItem when the mouse moves over a different row', () => {
    const onHoverItem = vi.fn();

    render(
      <FileReferenceAutocomplete
        results={files}
        selectedIndex={0}
        position={{ top: 8, left: 0 }}
        onSelect={vi.fn()}
        onHoverItem={onHoverItem}
        visible
      />
    );

    const second = document.querySelectorAll('[data-autocomplete-item]')[1] as HTMLElement;
    fireEvent.mouseMove(second, { clientX: 10, clientY: 20 });
    expect(onHoverItem).toHaveBeenCalledWith(1);
  });

  it('uses workspace-scoped keys when the same path appears in multiple workspaces', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const multiWsFiles: FileEntry[] = [
      { path: 'README.md', type: 'file', workspaceId: 'ws-a' },
      { path: 'README.md', type: 'file', workspaceId: 'ws-b' },
    ];

    render(
      <FileReferenceAutocomplete
        results={multiWsFiles}
        selectedIndex={0}
        position={{ top: 8, left: 0 }}
        onSelect={vi.fn()}
        onHoverItem={vi.fn()}
        visible
      />
    );

    expect(screen.getAllByText('README.md')).toHaveLength(2);

    const duplicateKeyErrors = consoleError.mock.calls.filter(([msg]) =>
      String(msg).includes('Encountered two children with the same key')
    );
    expect(duplicateKeyErrors).toHaveLength(0);

    consoleError.mockRestore();
  });
});
