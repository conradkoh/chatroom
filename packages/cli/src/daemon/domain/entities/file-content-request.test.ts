import { describe, expect, test } from 'vitest';

import type { FileContentRequest } from './file-content-request.js';

describe('file-content-request', () => {
  test('FileContentRequest shape has required fields', () => {
    const request: FileContentRequest = {
      requestId: 'req1',
      machineId: 'machine1',
      workingDir: '/workspace',
      filePath: 'src/index.ts',
      status: 'pending',
    };
    expect(request.filePath).toBe('src/index.ts');
    expect(request.status).toBe('pending');
  });
});
