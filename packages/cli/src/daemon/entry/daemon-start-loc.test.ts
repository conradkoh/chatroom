import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DAEMON_START_BASELINE = 20_283;
const DAEMON_START_TARGET = 10_000;

describe('daemon-start LOC guard (G7)', () => {
  it('daemon-start/**/*.ts is below 50% of baseline', () => {
    const out = execSync(
      'find src/commands/machine/daemon-start -name "*.ts" -print0 | xargs -0 wc -l | tail -1',
      { cwd: cliPackageRoot, encoding: 'utf8' }
    );
    const total = Number(out.trim().split(/\s+/)[0]);
    expect(total).toBeLessThan(DAEMON_START_TARGET);
    expect(total).toBeLessThan(DAEMON_START_BASELINE * 0.5);
  });
});
