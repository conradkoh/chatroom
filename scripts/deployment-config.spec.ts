import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import {
  formatDeploymentEnv,
  getProductionConvexUrl,
  readVercelProjectConfig,
} from './deployment-config';

const testDir = join(tmpdir(), `deployment-config-${process.pid}`);

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('readVercelProjectConfig', () => {
  it('reads the IDs written by vercel link', () => {
    mkdirSync(testDir, { recursive: true });
    const projectPath = join(testDir, 'project.json');
    writeFileSync(projectPath, JSON.stringify({ orgId: 'team_123', projectId: 'prj_456' }));

    expect(readVercelProjectConfig(projectPath)).toEqual({
      orgId: 'team_123',
      projectId: 'prj_456',
    });
  });

  it('reads an app from repository metadata written for a linked monorepo', () => {
    mkdirSync(testDir, { recursive: true });
    const projectPath = join(testDir, 'repo.json');
    writeFileSync(
      projectPath,
      JSON.stringify({
        projects: [
          {
            id: 'prj_456',
            orgId: 'team_123',
            directory: 'apps/webapp',
          },
        ],
      })
    );

    expect(readVercelProjectConfig(projectPath, 'apps/webapp')).toEqual({
      orgId: 'team_123',
      projectId: 'prj_456',
    });
  });

  it('returns null for missing or incomplete project metadata', () => {
    const projectPath = join(testDir, 'project.json');
    expect(readVercelProjectConfig(projectPath)).toBeNull();

    mkdirSync(testDir, { recursive: true });
    writeFileSync(projectPath, JSON.stringify({ projectId: 'prj_456' }));
    expect(readVercelProjectConfig(projectPath)).toBeNull();
  });
});

it('formats a block accepted by environment-variable UIs', () => {
  expect(
    formatDeploymentEnv('https://example.convex.cloud', {
      orgId: 'team_123',
      projectId: 'prj_456',
    })
  ).toBe(
    'NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud\n' +
      'VERCEL_PROJECT_ID=prj_456\n' +
      'VERCEL_TEAM_ID=team_123'
  );
});

describe('getProductionConvexUrl', () => {
  it('reads the JSON string returned by a Convex inline query', () => {
    const runQuery = () => ({
      status: 0,
      stdout: '"https://production.convex.cloud"\n',
    });
    expect(getProductionConvexUrl('/backend', runQuery)).toBe('https://production.convex.cloud');
  });

  it('rejects missing, malformed, and non-HTTPS values', () => {
    expect(getProductionConvexUrl('/backend', () => ({ status: 1, stdout: '' }))).toBeNull();
    expect(
      getProductionConvexUrl('/backend', () => ({ status: 0, stdout: 'not json' }))
    ).toBeNull();
    expect(
      getProductionConvexUrl('/backend', () => ({
        status: 0,
        stdout: '"http://127.0.0.1:3210"',
      }))
    ).toBeNull();
  });
});
