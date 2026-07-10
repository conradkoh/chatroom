import { describe, expect, it, vi } from 'vitest';

import { createFileReferenceTrigger, serializeFileReferencePath } from './fileReferenceTrigger';
import type { FileEntry } from '../components/FileSelector/useFileSelector';

const files: FileEntry[] = [
  { path: 'services/backend/convex/dev.ts', type: 'file' },
  { path: 'apps/webapp/src/modules/auth', type: 'directory' },
];

describe('createFileReferenceTrigger', () => {
  it('forwards onActivate to the trigger definition', () => {
    const onActivate = vi.fn();

    const trigger = createFileReferenceTrigger(files, { onActivate });
    trigger.onActivate?.();

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('is enabled when a workspace exists even before files are loaded', () => {
    const trigger = createFileReferenceTrigger([], { hasWorkspace: true });
    expect(trigger.isEnabled()).toBe(true);
  });

  it('is disabled when there is no workspace and no cached files', () => {
    const trigger = createFileReferenceTrigger([]);
    expect(trigger.isEnabled()).toBe(false);
  });

  it('includes directories in autocomplete results', () => {
    const trigger = createFileReferenceTrigger(files);
    const results = trigger.getResults('');
    expect(results.some((entry) => entry.type === 'directory')).toBe(true);
  });
  it('scopes results to children when query ends with a folder prefix', () => {
    const nestedFiles: FileEntry[] = [
      { path: 'very-long-folder-name', type: 'directory' },
      { path: 'very-long-folder-name/a.ts', type: 'file' },
      { path: 'very-long-folder-name/b.ts', type: 'file' },
      { path: 'other-folder/c.ts', type: 'file' },
    ];
    const trigger = createFileReferenceTrigger(nestedFiles);

    expect(trigger.getResults('very-long-folder-name/')).toEqual([
      { path: 'very-long-folder-name/a.ts', type: 'file' },
      { path: 'very-long-folder-name/b.ts', type: 'file' },
    ]);
  });
});

describe('serializeFileReferencePath', () => {
  it('leaves plain file paths unchanged', () => {
    expect(
      serializeFileReferencePath({ path: 'services/backend/convex/dev.ts', type: 'file' })
    ).toBe('services/backend/convex/dev.ts');
  });

  it('quotes file paths that contain spaces', () => {
    expect(serializeFileReferencePath({ path: 'my folder/file name.txt', type: 'file' })).toBe(
      '@"my folder/file name.txt"'
    );
  });
});

describe('serializeFileReferenceDrillDown', () => {
  it('appends trailing slash for directories', () => {
    const trigger = createFileReferenceTrigger([]);
    expect(trigger.serializeDrillDown?.({ path: 'auth', type: 'directory' })).toBe('auth/');
    expect(trigger.serializeDrillDown?.({ path: 'auth/', type: 'directory' })).toBe('auth/');
  });

  it('quotes directory segments that contain spaces', () => {
    const trigger = createFileReferenceTrigger([]);
    expect(trigger.serializeDrillDown?.({ path: 'my folder', type: 'directory' })).toBe(
      '"my folder"/'
    );
  });
});
