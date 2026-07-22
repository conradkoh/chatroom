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

export function buildProcessDefinitions(
  repoRoot: string,
  config: RuntimeConfig
): ProcessDefinition[] {
  const convexUrl =
    config.convexBackendMode === 'local'
      ? `http://127.0.0.1:${config.convexPort}`
      : config.convexUrl;
  const webappUrl = `http://localhost:${config.webappPort}`;

  const defs: ProcessDefinition[] = [];

  if (config.convexBackendMode === 'local') {
    defs.push({
      id: 'convex',
      name: 'Convex (local)',
      cwd: repoRoot,
      command: 'pnpm',
      args: ['--filter', '@workspace/backend', 'dev'],
      env: {
        CONVEX_NON_INTERACTIVE: 'true',
        DOCUMENT_RETENTION_DELAY: '1',
        INDEX_RETENTION_DELAY: '1',
        RETENTION_DELETE_FREQUENCY: '10',
      },
    });
  }

  defs.push({
    id: 'webapp',
    name: 'Webapp (production build)',
    cwd: repoRoot,
    command: 'sh',
    args: [
      '-c',
      `pnpm turbo run build --filter=@workspace/webapp && PORT=${config.webappPort} pnpm --filter @workspace/webapp exec dotenv -e apps/webapp/.env.local -- pnpm start`,
    ],
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
    },
    shell: false,
  });

  defs.push({
    id: 'daemon',
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
  });

  return defs;
}
