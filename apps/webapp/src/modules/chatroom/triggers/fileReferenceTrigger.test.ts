import { describe, expect, it, vi } from 'vitest';

import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { createFileReferenceTrigger } from './fileReferenceTrigger';

const files: FileEntry[] = [{ path: 'services/backend/convex/dev.ts', type: 'file' }];

describe('createFileReferenceTrigger', () => {
  it('forwards onActivate to the trigger definition', () => {
    const onActivate = vi.fn();

    const trigger = createFileReferenceTrigger(files, onActivate);
    trigger.onActivate?.();

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
