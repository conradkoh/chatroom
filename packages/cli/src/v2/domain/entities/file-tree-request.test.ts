import { describe, expect, test } from 'vitest';

import type { FileTreeRequest } from './file-tree-request.js';

describe('file-tree-request', () => {
  test('FileTreeRequest shape has required fields', () => {
    const request: FileTreeRequest = {
      requestId: 'req1',
      machineId: 'machine1',
      workingDir: '/workspace',
      force: true,
      status: 'pending',
    };
    expect(request.requestId).toBe('req1');
    expect(request.force).toBe(true);
    expect(request.status).toBe('pending');
  });
});
