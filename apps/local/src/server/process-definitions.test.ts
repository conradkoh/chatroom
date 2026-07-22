import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { buildProcessDefinitions } from './process-definitions.js';

function writeLocalConvexConfig(repoRoot: string, config: object) {
  const configDir = join(repoRoot, 'services/backend/.convex/local/default');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config));
}

describe('buildProcessDefinitions', () => {
  it('overrides convex deployment env for local backend mode', () => {
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
    expect(convex?.env.CONVEX_DEPLOYMENT).toBe('local:local-conradkoh-chatroom_a8c82');
    expect(convex?.env.VITE_CONVEX_URL).toBe('http://127.0.0.1:3210');
    expect(convex?.args).toEqual(['exec', 'convex', 'dev']);
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
