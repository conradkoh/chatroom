import { describe, expect, it, vi } from 'vitest';
import { listLogHistory } from './list-log-history.js';
describe('listLogHistory', () => {
  it('uses afterId when supplied', () => {
    const reader = { queryAfterId: vi.fn(() => []), queryHistory: vi.fn(() => []), listSources: () => [] };
    listLogHistory(reader, { afterId: 4, source: 'agent' });
    expect(reader.queryAfterId).toHaveBeenCalledWith(4, 500, 'agent', undefined, undefined, undefined);
    expect(reader.queryHistory).not.toHaveBeenCalled();
  });
  it('uses beforeId and requested limit otherwise', () => {
    const reader = { queryAfterId: vi.fn(() => []), queryHistory: vi.fn(() => []), listSources: () => [] };
    listLogHistory(reader, { beforeId: 9, limit: 20 });
    expect(reader.queryHistory).toHaveBeenCalledWith(9, 20, undefined, undefined, undefined, undefined);
  });
});
