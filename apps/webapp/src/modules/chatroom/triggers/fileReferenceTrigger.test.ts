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
});

describe('serializeFileReferencePath', () => {
  it('appends trailing slash for directories', () => {
    expect(serializeFileReferencePath({ path: 'auth', type: 'directory' })).toBe('auth/');
    expect(serializeFileReferencePath({ path: 'auth/', type: 'directory' })).toBe('auth/');
  });

  it('leaves file paths unchanged', () => {
    expect(
      serializeFileReferencePath({ path: 'services/backend/convex/dev.ts', type: 'file' })
    ).toBe('services/backend/convex/dev.ts');
  });
});
