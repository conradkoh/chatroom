import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRepositoryLedgerPath } from './repository-ledger-path.js';

describe('resolveRepositoryLedgerPath', () => {
  it('returns a path under ~/.chatroom/daemon/<machineId>/repository-ledger.json', () => {
    const resolved = resolveRepositoryLedgerPath('m1');

    expect(resolved.endsWith(join('.chatroom', 'daemon', 'm1', 'repository-ledger.json'))).toBe(
      true
    );
  });
});
