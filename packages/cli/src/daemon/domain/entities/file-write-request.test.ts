import { describe, expect, test } from 'vitest';

import type { FileWriteRequest } from './file-write-request.js';

describe('file-write-request', () => {
  test('FileWriteRequest shape has required fields', () => {
    const request: FileWriteRequest = {
      requestId: 'req1',
      machineId: 'machine1',
      workingDir: '/workspace',
      filePath: 'src/index.ts',
      content: 'export const x = 1;',
      status: 'pending',
    };
    expect(request.content).toBe('export const x = 1;');
    expect(request.status).toBe('pending');
  });
});
