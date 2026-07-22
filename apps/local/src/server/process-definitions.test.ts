import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { buildProcessDefinitions } from './process-definitions.js';

function writeLocalConvexConfig(repoRoot: string, config: object, subpath = 'default') {
  const configDir = join(repoRoot, 'services/backend/.convex/local', subpath);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config));
}

describe('buildProcessDefinitions', () => {
  it('uses env-file override for local backend mode', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'chatroom-local-'));
    writeLocalConvexConfig(repoRoot, {
      deploymentName: 'local-conradkoh-chatroom_a8c82',
      ports: { cloud: 3210, site: 3211 },
    });

    const defs = buildProcessDefinitions(repoRoot, {
      webappPort: 3000,
      convexBackendMode: 'local',
      convexPort: 3210,
      convexUrl: 'https://ignored.convex.cloud',
    });

    const convex = defs.find((def) => def.id === 'convex');
    expect(convex?.args).toEqual([
      'exec',
      'convex',
      'dev',
      '--env-file',
      join(repoRoot, 'services/backend/.convex/local-dev.env'),
    ]);

    const webapp = defs.find((def) => def.id === 'webapp');
    expect(webapp?.args[1]).toContain(
      'Starting Next.js production server on http://localhost:3000'
    );
    expect(webapp?.args[1]).toContain('dotenv -e .env.local -- pnpm start');

    const envFile = join(repoRoot, 'services/backend/.convex/local-dev.env');
    const envContents = readFileSync(envFile, 'utf8');
    expect(envContents).toContain('CONVEX_DEPLOYMENT=local:local-conradkoh-chatroom_a8c82');
    expect(envContents).toContain('VITE_CONVEX_URL=http://127.0.0.1:3210');
    expect(envContents).not.toContain('wonderful-raven-192');
  });

  it('prefers newest backup config when multiple backups exist', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'chatroom-local-'));
    writeLocalConvexConfig(
      repoRoot,
      { deploymentName: 'older-backup', ports: { cloud: 3210, site: 3211 } },
      '../local-backup-20260722-100000/default'
    );
    writeLocalConvexConfig(
      repoRoot,
      { deploymentName: 'newer-backup', ports: { cloud: 3210, site: 3211 } },
      '../local-backup-20260722-110000/default'
    );

    buildProcessDefinitions(repoRoot, {
      webappPort: 3000,
      convexBackendMode: 'local',
      convexPort: 3210,
      convexUrl: 'https://ignored.convex.cloud',
    });

    const envContents = readFileSync(
      join(repoRoot, 'services/backend/.convex/local-dev.env'),
      'utf8'
    );
    expect(envContents).toContain('CONVEX_DEPLOYMENT=local:newer-backup');
  });

  it('resolves deployment from backup config when active state is missing', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'chatroom-local-'));
    writeLocalConvexConfig(
      repoRoot,
      {
        deploymentName: 'local-from-backup',
        ports: { cloud: 3210, site: 3211 },
      },
      '../local-backup-20260722-110354/default'
    );

    const defs = buildProcessDefinitions(repoRoot, {
      webappPort: 3000,
      convexBackendMode: 'local',
      convexPort: 3210,
      convexUrl: 'https://ignored.convex.cloud',
    });

    const envFile = join(repoRoot, 'services/backend/.convex/local-dev.env');
    const envContents = readFileSync(envFile, 'utf8');
    expect(envContents).toContain('CONVEX_DEPLOYMENT=local:local-from-backup');
    expect(defs.find((def) => def.id === 'convex')?.args).toContain('--env-file');
  });

  it('passes hosted convex URL through for hosted backend mode', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'chatroom-local-'));
    const hostedUrl = 'https://wonderful-raven-192.convex.cloud';

    const defs = buildProcessDefinitions(repoRoot, {
      webappPort: 6249,
      convexBackendMode: 'hosted',
      convexPort: 3210,
      convexUrl: hostedUrl,
    });

    expect(defs.find((def) => def.id === 'convex')).toBeUndefined();
    expect(defs.find((def) => def.id === 'webapp')?.env.NEXT_PUBLIC_CONVEX_URL).toBe(hostedUrl);
    expect(defs.find((def) => def.id === 'daemon')?.env.CHATROOM_CONVEX_URL).toBe(hostedUrl);
  });
});
