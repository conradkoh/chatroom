import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { handleHealth, handleHarnessHistory } from './routes.js';
import type { PersistenceStore } from '../../infrastructure/persistence/index.js';

function mockResponse(): ServerResponse & { statusCode?: number | undefined; body?: string | undefined } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(status: number, _headers?: Record<string, string>) {
      this.statusCode = status;
    },
    end(chunk?: string) {
      this.body = chunk;
    },
    write: vi.fn(),
  };
  return res as unknown as ServerResponse & { statusCode?: number | undefined; body?: string | undefined };
}

describe('handleHealth', () => {
  it('returns ok status', () => {
    const res = mockResponse();
    handleHealth({} as IncomingMessage, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ status: 'ok', service: 'v2-local-web' });
  });
});

describe('handleHarnessHistory', () => {
  it('returns empty lines when persistence is missing', () => {
    const res = mockResponse();
    const req = { url: '/api/harness/history' } as IncomingMessage;
    handleHarnessHistory(req, res, undefined);
    expect(JSON.parse(res.body!)).toEqual({ lines: [] });
  });

  it('reads lines from persistence with query params', () => {
    const line = {
      type: 'harness.stream' as const,
      harness: 'h1',
      stream: 'stdout' as const,
      line: 'hello',
      timestamp: 1,
    };
    const persistence = {
      listHarnessStreamLines: vi.fn().mockReturnValue([line]),
    } as unknown as PersistenceStore;

    const res = mockResponse();
    const req = { url: '/api/harness/history?harness=h1&limit=10' } as IncomingMessage;
    handleHarnessHistory(req, res, persistence);

    expect(persistence.listHarnessStreamLines).toHaveBeenCalledWith({
      harness: 'h1',
      limit: 10,
    });
    expect(JSON.parse(res.body!)).toEqual({ lines: [line] });
  });
});
