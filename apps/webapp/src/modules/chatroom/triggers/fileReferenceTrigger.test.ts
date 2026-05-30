import { describe, expect, it, vi } from 'vitest';

import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { createFileReferenceTrigger, serializeFileReferencePath } from './fileReferenceTrigger';

const files: FileEntry[] = [
  { path: 'services/backend/convex/dev.ts', type: 'file' },
  { path: 'apps/webapp/src/modules/auth', type: 'directory' },
];

describe('createFileReferenceTrigger', () => {
  it('forwards onActivate to the trigger definition', () => {
    const onActivate = vi.fn();

    const trigger = createFileReferenceTrigger(files, onActivate);
    trigger.onActivate?.();

    expect(onActivate).toHaveBeenCalledTimes(1);
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
