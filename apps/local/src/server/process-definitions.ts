import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ManagedProcessId, RuntimeConfig } from '../shared/protocol.js';

export type ProcessDefinition = {
  id: ManagedProcessId;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  shell?: boolean;
};

type LocalConvexConfig = {
  deploymentName?: string;
  ports?: { cloud?: number; site?: number };
};

function readLocalConvexConfig(repoRoot: string): LocalConvexConfig | null {
  try {
    const configPath = join(repoRoot, 'services/backend/.convex/local/default/config.json');
    return JSON.parse(readFileSync(configPath, 'utf8')) as LocalConvexConfig;
  } catch {
    return null;
  }
}

function localConvexDeployment(repoRoot: string): string | undefined {
  const name = readLocalConvexConfig(repoRoot)?.deploymentName;
  return name ? `local:${name}` : undefined;
}

function localConvexCloudPort(repoRoot: string, fallback: number): number {
  return readLocalConvexConfig(repoRoot)?.ports?.cloud ?? fallback;
}

function localConvexSitePort(repoRoot: string, fallback: number): number {
  const cloudPort = localConvexCloudPort(repoRoot, fallback);
  return readLocalConvexConfig(repoRoot)?.ports?.site ?? cloudPort + 1;
}

function resolveConvexUrl(repoRoot: string, config: RuntimeConfig): string {
  if (config.convexBackendMode !== 'local') return config.convexUrl;
  return `http://127.0.0.1:${localConvexCloudPort(repoRoot, config.convexPort)}`;
}

function buildConvexDefinition(repoRoot: string, config: RuntimeConfig, convexUrl: string) {
  const env: Record<string, string> = {
    CONVEX_NON_INTERACTIVE: 'true',
    DOCUMENT_RETENTION_DELAY: '1',
    INDEX_RETENTION_DELAY: '1',
    RETENTION_DELETE_FREQUENCY: '10',
    VITE_CONVEX_URL: convexUrl,
    VITE_CONVEX_SITE_URL: `http://127.0.0.1:${localConvexSitePort(repoRoot, config.convexPort)}`,
  };
  const deployment = localConvexDeployment(repoRoot);
  if (deployment) env.CONVEX_DEPLOYMENT = deployment;

  return {
    id: 'convex' as const,
    name: 'Convex (local)',
    cwd: join(repoRoot, 'services/backend'),
    command: 'pnpm',
    args: ['exec', 'convex', 'dev'],
    env,
  };
}

function buildWebappDefinition(repoRoot: string, config: RuntimeConfig, convexUrl: string) {
  return {
    id: 'webapp' as const,
    name: 'Webapp (production build)',
    cwd: repoRoot,
    command: 'sh',
    args: [
      '-c',
      `NEXT_PUBLIC_CONVEX_URL=${convexUrl} pnpm turbo run build --filter=@workspace/webapp && PORT=${config.webappPort} NEXT_PUBLIC_CONVEX_URL=${convexUrl} pnpm --filter @workspace/webapp exec dotenv -e apps/webapp/.env.local -- pnpm start`,
    ],
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
    },
    shell: false,
  };
}

function buildDaemonDefinition(repoRoot: string, convexUrl: string, webappUrl: string) {
  return {
    id: 'daemon' as const,
    name: 'Chatroom Daemon',
    cwd: repoRoot,
    command: 'sh',
    args: [
      '-c',
      'pnpm turbo run build --filter=chatroom-cli && pnpm exec chatroom machine daemon start',
    ],
    env: {
      CHATROOM_CONVEX_URL: convexUrl,
      CHATROOM_WEB_URL: webappUrl,
    },
    shell: false,
  };
}

export function buildProcessDefinitions(
  repoRoot: string,
  config: RuntimeConfig
): ProcessDefinition[] {
  const convexUrl = resolveConvexUrl(repoRoot, config);
  const webappUrl = `http://localhost:${config.webappPort}`;
  const defs: ProcessDefinition[] = [];

  if (config.convexBackendMode === 'local') {
    defs.push(buildConvexDefinition(repoRoot, config, convexUrl));
  }

  defs.push(buildWebappDefinition(repoRoot, config, convexUrl));
  defs.push(buildDaemonDefinition(repoRoot, convexUrl, webappUrl));

  return defs;
}
