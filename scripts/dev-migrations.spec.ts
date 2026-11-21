import { describe, expect, it } from 'bun:test';

import { type ConvexTarget, localBackendProbeUrl, resolveDevTarget } from './convex-target';
import { devMigrationSkipReason, devStartRefusal } from './dev-migrations';
import { waitForAcceptance } from './migrate-lib';

const local: ConvexTarget = {
  kind: 'local',
  deployment: 'local:local-acme-demo-2',
  url: 'http://127.0.0.1:3210',
};
const localWithUrl: ConvexTarget = {
  kind: 'local',
  deployment: 'local:local-acme-demo-2',
  url: 'http://127.0.0.1:4000',
};
const hosted: ConvexTarget = {
  kind: 'hosted-dev',
  deployment: 'dev:happy-animal-123',
  url: 'https://happy-animal-123.convex.cloud',
};
const prod: ConvexTarget = { kind: 'prod-without-key', deployment: 'prod:happy-animal-123' };
const unconfigured: ConvexTarget = { kind: 'unconfigured' };
const deployKeyFile: ConvexTarget = { kind: 'deploy-key-in-file' };
const configJson = '{"ports":{"cloud":3210,"site":3211},"backendVersion":"precompiled-test"}';

describe('devMigrationSkipReason', () => {
  it('runs migrations for local and hosted development deployments', () => {
    expect(devMigrationSkipReason(local, {})).toBeUndefined();
    expect(devMigrationSkipReason(hosted, {})).toBeUndefined();
  });

  it('skips with a reason for an unconfigured target', () => {
    expect(devMigrationSkipReason(unconfigured, {})).toContain(
      'no development deployment is configured'
    );
  });

  it('skips for any target when SKIP_DEV_MIGRATIONS is exactly 1', () => {
    expect(devMigrationSkipReason(hosted, { SKIP_DEV_MIGRATIONS: '1' })).toContain(
      'SKIP_DEV_MIGRATIONS=1'
    );
    expect(devMigrationSkipReason(hosted, { SKIP_DEV_MIGRATIONS: '0' })).toBeUndefined();
  });

  it('skips when the key is only in .env.local', () => {
    expect(devMigrationSkipReason(deployKeyFile, {})).toContain(
      'CONVEX_DEPLOY_KEY is set in services/backend/.env.local'
    );
  });
});

describe('devStartRefusal', () => {
  it('refuses a prod: selector with the production wording, with or without a key', () => {
    for (const key of [undefined, 'process environment' as const]) {
      const message = devStartRefusal(prod, key);
      expect(message).toContain('Refusing to start Convex dev');
      expect(message).toContain('prod:happy-animal-123');
      expect(message).toContain('pnpm dev never runs against production');
      expect(message).not.toContain('is not set');
    }
  });

  it('gives the corrected production refusal when CONVEX_DEPLOY_KEY is also set', () => {
    const target = resolveDevTarget({
      env: { CONVEX_DEPLOYMENT: 'prod:happy-animal-123', CONVEX_DEPLOY_KEY: 'test-key' },
    });
    const message = devStartRefusal(target, 'process environment');
    expect(message).toContain('pnpm dev never runs against production');
    expect(message).not.toContain('is not set');
    expect(message).not.toContain('test-key');
  });

  it('refuses to start when CONVEX_DEPLOY_KEY is set in the process env or .env.local', () => {
    expect(devStartRefusal(hosted, 'process environment')).toContain(
      'CONVEX_DEPLOY_KEY is set in process environment'
    );
    expect(devStartRefusal(local, 'services/backend/.env.local')).toContain(
      'CONVEX_DEPLOY_KEY is set in services/backend/.env.local'
    );
  });

  it('lets dev start for local, hosted, and unconfigured targets when no key is set', () => {
    expect(devStartRefusal(local)).toBeUndefined();
    expect(devStartRefusal(hosted)).toBeUndefined();
    expect(devStartRefusal(unconfigured)).toBeUndefined();
  });
});

describe('localBackendProbeUrl', () => {
  it('prefers the target URL over the recorded port', () => {
    expect(localBackendProbeUrl(localWithUrl, configJson)).toBe('http://127.0.0.1:4000');
  });

  it('uses the recorded ports.cloud when the local target has no URL', () => {
    expect(
      localBackendProbeUrl({ kind: 'local', deployment: 'local:local-acme-demo-2' }, configJson)
    ).toBe('http://127.0.0.1:3210');
  });

  it('is undefined when neither a URL nor a recorded port is known', () => {
    const noUrl: ConvexTarget = { kind: 'local', deployment: 'local:local-acme-demo-2' };
    expect(localBackendProbeUrl(noUrl, '')).toBeUndefined();
    expect(localBackendProbeUrl(noUrl, '{}')).toBeUndefined();
    expect(localBackendProbeUrl(noUrl, 'not json')).toBeUndefined();
  });

  it('is undefined for hosted targets', () => {
    expect(localBackendProbeUrl(hosted, configJson)).toBeUndefined();
  });
});

describe('waitForAcceptance', () => {
  it('resolves once the probe accepts, after earlier failures', async () => {
    let calls = 0;
    await waitForAcceptance(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('not up yet');
      },
      { timeoutMs: 5_000, intervalMs: 1 }
    );
    expect(calls).toBe(3);
  });

  it('fails with a timeout that carries the last probe error', async () => {
    await expect(
      waitForAcceptance(
        async () => {
          throw new Error('connection refused');
        },
        { timeoutMs: 20, intervalMs: 1 }
      )
    ).rejects.toThrow(/Timed out.*connection refused/);
  });

  it('fails within its timeout when a probe never settles', async () => {
    await expect(
      waitForAcceptance(() => new Promise<never>(() => {}), { timeoutMs: 30, intervalMs: 1 })
    ).rejects.toThrow(/Timed out/);
  });
});
