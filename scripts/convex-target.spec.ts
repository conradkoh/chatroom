import { describe, expect, it } from 'bun:test';

import {
  buildConvexRunArgs,
  deployKeySource,
  describeConvexTarget,
  readEnvValue,
  resolveConvexTarget,
  resolveDevTarget,
  unrunnableReason,
} from './convex-target';

const hostedEnvFile = [
  'CONVEX_DEPLOYMENT=dev:happy-animal-123 # team: acme, project: demo',
  'VITE_CONVEX_URL=https://happy-animal-123.convex.cloud',
  '',
].join('\n');

const localEnvFile = [
  'CONVEX_DEPLOYMENT=local:local-acme-demo-2 # team: acme, project: demo',
  'VITE_CONVEX_URL=http://127.0.0.1:3210',
  '',
].join('\n');

const prodEnvFile = [
  'CONVEX_DEPLOYMENT=prod:happy-animal-123 # team: acme, project: demo',
  'VITE_CONVEX_URL=https://happy-animal-123.convex.cloud',
  '',
].join('\n');

describe('readEnvValue', () => {
  it('returns undefined for an empty value instead of the next line', () => {
    const envFile = 'CONVEX_DEPLOYMENT=\nVITE_CONVEX_URL=https://happy-animal-123.convex.cloud\n';
    expect(readEnvValue(envFile, 'CONVEX_DEPLOYMENT')).toBeUndefined();
    expect(readEnvValue(envFile, 'VITE_CONVEX_URL')).toBe('https://happy-animal-123.convex.cloud');
  });

  it('treats an empty quoted value as unset', () => {
    expect(readEnvValue('CONVEX_DEPLOYMENT=""\n', 'CONVEX_DEPLOYMENT')).toBeUndefined();
  });

  it('strips matching double or single quotes and a trailing comment', () => {
    expect(readEnvValue('CONVEX_DEPLOYMENT="local:local-acme-demo-2"\n', 'CONVEX_DEPLOYMENT')).toBe(
      'local:local-acme-demo-2'
    );
    expect(
      readEnvValue("CONVEX_DEPLOYMENT='dev:happy-animal-123' # note\n", 'CONVEX_DEPLOYMENT')
    ).toBe('dev:happy-animal-123');
  });
});

describe('resolveDevTarget', () => {
  it('classifies a hosted dev deployment from .env.local as hosted-dev', () => {
    expect(resolveDevTarget({ envFile: hostedEnvFile })).toEqual({
      kind: 'hosted-dev',
      deployment: 'dev:happy-animal-123',
      url: 'https://happy-animal-123.convex.cloud',
    });
  });

  it('classifies a local: deployment with a loopback URL as local', () => {
    expect(resolveDevTarget({ envFile: localEnvFile })).toEqual({
      kind: 'local',
      deployment: 'local:local-acme-demo-2',
      url: 'http://127.0.0.1:3210',
    });
  });

  it('keeps an explicit dev: deployment hosted and drops a stale loopback URL', () => {
    const target = resolveDevTarget({
      envFile: 'CONVEX_DEPLOYMENT=dev:happy-animal-123\nVITE_CONVEX_URL=http://127.0.0.1:3210\n',
    });
    expect(target).toEqual({ kind: 'hosted-dev', deployment: 'dev:happy-animal-123' });
    expect(describeConvexTarget(target)).toBe('HOSTED development deployment dev:happy-animal-123');
    expect(describeConvexTarget(target)).not.toContain('127.0.0.1');
  });

  it('keeps a remote URL for an explicit dev: deployment', () => {
    expect(
      resolveDevTarget({
        envFile:
          'CONVEX_DEPLOYMENT=dev:happy-animal-123\nVITE_CONVEX_URL=https://happy-animal-123.convex.cloud\n',
      })
    ).toEqual({
      kind: 'hosted-dev',
      deployment: 'dev:happy-animal-123',
      url: 'https://happy-animal-123.convex.cloud',
    });
  });

  it('keeps an explicit local: deployment local even with a remote URL', () => {
    const target = resolveDevTarget({
      envFile:
        'CONVEX_DEPLOYMENT=local:local-acme-demo-2\nVITE_CONVEX_URL=https://happy-animal-123.convex.cloud\n',
    });
    expect(target).toEqual({
      kind: 'local',
      deployment: 'local:local-acme-demo-2',
      url: 'https://happy-animal-123.convex.cloud',
    });
    expect(describeConvexTarget(target)).toContain('LOCAL');
    expect(describeConvexTarget(target)).not.toContain('HOSTED');
  });

  it('classifies a quoted local: deployment as local', () => {
    expect(resolveDevTarget({ envFile: 'CONVEX_DEPLOYMENT="local:local-acme-demo-2"\n' })).toEqual({
      kind: 'local',
      deployment: 'local:local-acme-demo-2',
    });
  });

  it('ignores an empty CONVEX_DEPLOYMENT and classifies by the URL on the next line', () => {
    const target = resolveDevTarget({
      envFile: 'CONVEX_DEPLOYMENT=\nVITE_CONVEX_URL=https://happy-animal-123.convex.cloud\n',
    });
    expect(target).toEqual({ kind: 'hosted-dev', url: 'https://happy-animal-123.convex.cloud' });
    expect(describeConvexTarget(target)).toBe(
      'HOSTED development deployment at https://happy-animal-123.convex.cloud'
    );
  });

  it('classifies a prod: deployment without a key as prod-without-key, never hosted dev', () => {
    const target = resolveDevTarget({ envFile: prodEnvFile });
    expect(target).toEqual({ kind: 'prod-without-key', deployment: 'prod:happy-animal-123' });
    expect(describeConvexTarget(target)).toBe(
      'PRODUCTION deployment prod:happy-animal-123 selected by CONVEX_DEPLOYMENT'
    );
    expect(describeConvexTarget(target)).not.toContain('is not set');
    expect(describeConvexTarget(target)).not.toContain('HOSTED');
  });

  it('classifies anonymous: deployments as local', () => {
    expect(
      resolveDevTarget({ env: { CONVEX_DEPLOYMENT: 'anonymous:anonymous-acme-demo' } }).kind
    ).toBe('local');
  });

  it('recognises the loopback hosts from the existing rule', () => {
    for (const url of ['http://127.0.0.1:3210', 'http://localhost:3210', 'http://[::1]:3210']) {
      expect(resolveDevTarget({ env: { VITE_CONVEX_URL: url } }).kind).toBe('local');
    }
    expect(
      resolveDevTarget({ env: { VITE_CONVEX_URL: 'https://wonderful-raven-192.convex.cloud' } })
        .kind
    ).toBe('hosted-dev');
  });

  it('lets process env CONVEX_DEPLOYMENT override .env.local', () => {
    expect(
      resolveDevTarget({ env: { CONVEX_DEPLOYMENT: 'local:other-2' }, envFile: hostedEnvFile })
    ).toEqual({
      kind: 'local',
      deployment: 'local:other-2',
      url: 'https://happy-animal-123.convex.cloud',
    });
  });

  it('reports unconfigured when there is no config at all, with a named label', () => {
    const target = resolveDevTarget({});
    expect(target).toEqual({ kind: 'unconfigured' });
    expect(describeConvexTarget(target)).toContain('UNCONFIGURED');
    expect(describeConvexTarget(target)).not.toContain('HOSTED');
  });
});

describe('resolveConvexTarget', () => {
  it('targets production and passes --prod when CONVEX_DEPLOY_KEY is set, even with a dev .env.local', () => {
    const target = resolveConvexTarget({ deployKey: 'test-deploy-key', envFile: hostedEnvFile });
    expect(target).toEqual({ kind: 'production' });
    expect(buildConvexRunArgs(target, 'migrations:runAll')).toEqual([
      'run',
      'migrations:runAll',
      '--prod',
    ]);
  });

  it('treats an empty CONVEX_DEPLOY_KEY as unset', () => {
    expect(resolveConvexTarget({ deployKey: '', envFile: hostedEnvFile }).kind).toBe('hosted-dev');
  });

  it('targets a hosted dev deployment from .env.local without --prod, and does not call it local', () => {
    const target = resolveConvexTarget({ envFile: hostedEnvFile });
    expect(target.kind).toBe('hosted-dev');
    expect(buildConvexRunArgs(target, 'migrations:runAll')).toEqual(['run', 'migrations:runAll']);
  });

  it('targets a local deployment from .env.local without --prod', () => {
    const target = resolveConvexTarget({ envFile: localEnvFile });
    expect(target.kind).toBe('local');
    expect(buildConvexRunArgs(target, 'migrations:runAll')).toEqual(['run', 'migrations:runAll']);
    expect(unrunnableReason(target)).toBeUndefined();
  });

  it('refuses prod: without a deploy key: no run command is built and the reason says why', () => {
    const target = resolveConvexTarget({ envFile: prodEnvFile });
    expect(target.kind).toBe('prod-without-key');
    expect(unrunnableReason(target)).toContain('CONVEX_DEPLOY_KEY');
    expect(() => buildConvexRunArgs(target, 'migrations:runAll')).toThrow('CONVEX_DEPLOY_KEY');
  });

  it('refuses an unconfigured target with actionable guidance', () => {
    const target = resolveConvexTarget({});
    expect(target).toEqual({ kind: 'unconfigured' });
    expect(unrunnableReason(target)).toContain('npx convex dev');
    expect(() => buildConvexRunArgs(target, 'migrations:runAll')).toThrow('npx convex dev');
  });

  it('never prints the deploy key', () => {
    expect(
      describeConvexTarget(resolveConvexTarget({ deployKey: 'secret-key-123' }))
    ).not.toContain('secret-key-123');
  });

  it('refuses to migrate when CONVEX_DEPLOY_KEY is only in .env.local, and names the file not the key', () => {
    const target = resolveConvexTarget({
      envFile: 'CONVEX_DEPLOY_KEY=file-key-123\nCONVEX_DEPLOYMENT=dev:happy-animal-123\n',
    });
    expect(target).toEqual({ kind: 'deploy-key-in-file' });
    expect(unrunnableReason(target)).toContain('services/backend/.env.local');
    expect(() => buildConvexRunArgs(target, 'migrations:runAll')).toThrow(
      'services/backend/.env.local'
    );
    expect(describeConvexTarget(target)).not.toContain('file-key-123');
  });

  it('still targets production for a process-env key even when .env.local has one', () => {
    expect(
      resolveConvexTarget({ deployKey: 'env-key', envFile: 'CONVEX_DEPLOY_KEY=file-key\n' })
    ).toEqual({ kind: 'production' });
  });
});

describe('deployKeySource', () => {
  it('reports the process environment before .env.local', () => {
    expect(
      deployKeySource({ env: { CONVEX_DEPLOY_KEY: 'k' }, envFile: 'CONVEX_DEPLOY_KEY=f\n' })
    ).toBe('process environment');
    expect(deployKeySource({ envFile: 'CONVEX_DEPLOY_KEY=f\n' })).toBe(
      'services/backend/.env.local'
    );
  });

  it('treats an empty value as unset', () => {
    expect(
      deployKeySource({ env: { CONVEX_DEPLOY_KEY: '' }, envFile: 'CONVEX_DEPLOY_KEY=\n' })
    ).toBeUndefined();
  });
});

describe('describeConvexTarget', () => {
  it('labels production', () => {
    expect(describeConvexTarget({ kind: 'production' })).toContain('PRODUCTION');
  });

  it('labels a hosted dev deployment with its name and URL, never as LOCAL', () => {
    const label = describeConvexTarget(resolveConvexTarget({ envFile: hostedEnvFile }));
    expect(label).toContain('HOSTED');
    expect(label).toContain('dev:happy-animal-123');
    expect(label).toContain('https://happy-animal-123.convex.cloud');
    expect(label).not.toContain('LOCAL');
  });

  it('labels a local deployment as LOCAL', () => {
    expect(describeConvexTarget(resolveConvexTarget({ envFile: localEnvFile }))).toContain('LOCAL');
  });
});
