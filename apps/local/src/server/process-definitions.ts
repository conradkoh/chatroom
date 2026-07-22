import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  localConvexCloudPort,
  localConvexDeployment,
  localConvexSitePort,
} from './convex-local-config.js';
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

const CONVEX_ENV_FILE = 'services/backend/.convex/local-dev.env';

function resolveConvexUrl(repoRoot: string, config: RuntimeConfig): string {
  if (config.convexBackendMode !== 'local') return config.convexUrl;
  return `http://127.0.0.1:${localConvexCloudPort(repoRoot, config.convexPort)}`;
}

function writeConvexLocalEnvFile(
  repoRoot: string,
  config: RuntimeConfig,
  convexUrl: string
): string {
  const envPath = join(repoRoot, CONVEX_ENV_FILE);
  mkdirSync(join(repoRoot, 'services/backend/.convex'), { recursive: true });

  const siteUrl = `http://127.0.0.1:${localConvexSitePort(repoRoot, config.convexPort)}`;
  const lines = [
    'CONVEX_NON_INTERACTIVE=true',
    'DOCUMENT_RETENTION_DELAY=1',
    'INDEX_RETENTION_DELAY=1',
    'RETENTION_DELETE_FREQUENCY=10',
    `VITE_CONVEX_URL=${convexUrl}`,
    `VITE_CONVEX_SITE_URL=${siteUrl}`,
  ];

  const deployment = localConvexDeployment(repoRoot);
  if (deployment) lines.push(`CONVEX_DEPLOYMENT=${deployment}`);

  writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
  return envPath;
}

function buildConvexDefinition(repoRoot: string, config: RuntimeConfig, convexUrl: string) {
  const envFilePath = writeConvexLocalEnvFile(repoRoot, config, convexUrl);

  return {
    id: 'convex' as const,
    name: 'Convex (local)',
    cwd: join(repoRoot, 'services/backend'),
    command: 'pnpm',
    args: ['exec', 'convex', 'dev', '--env-file', envFilePath],
    env: {},
  };
}

function buildWebappDefinition(repoRoot: string, config: RuntimeConfig, convexUrl: string) {
  const port = config.webappPort;
  return {
    id: 'webapp' as const,
    name: 'Webapp (production build)',
    cwd: repoRoot,
    command: 'sh',
    args: [
      '-c',
      `NEXT_PUBLIC_CONVEX_URL=${convexUrl} pnpm turbo run build --filter=@workspace/webapp && echo "Starting Next.js production server on http://localhost:${port} ..." && PORT=${port} NEXT_PUBLIC_CONVEX_URL=${convexUrl} pnpm --filter @workspace/webapp exec dotenv -e .env.local -- pnpm start`,
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
