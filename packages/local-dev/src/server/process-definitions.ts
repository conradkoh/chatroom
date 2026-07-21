import { join } from 'node:path';

import { readEnvFile } from './read-env.js';
import type { ManagedProcessId } from '../shared/protocol.js';

export type ProcessDefinition = {
  id: ManagedProcessId;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  shell?: boolean;
};

export function buildProcessDefinitions(repoRoot: string): ProcessDefinition[] {
  const backendEnv = readEnvFile(join(repoRoot, 'services/backend/.env.local'));
  const convexUrl = backendEnv.CONVEX_URL ?? 'http://127.0.0.1:3210';
  const webUrl = 'http://localhost:3000';

  return [
    {
      id: 'convex',
      name: 'Convex (local)',
      cwd: join(repoRoot, 'services/backend'),
      command: 'npx',
      args: ['convex', 'dev'],
      env: {
        CONVEX_NON_INTERACTIVE: 'true',
        DOCUMENT_RETENTION_DELAY: '1',
        INDEX_RETENTION_DELAY: '1',
        RETENTION_DELETE_FREQUENCY: '10',
      },
    },
    {
      id: 'webapp',
      name: 'Webapp (production build)',
      cwd: join(repoRoot, 'apps/webapp'),
      command: 'sh',
      args: ['-c', 'pnpm build && pnpm exec dotenv -e .env.local -- next start -p 3000'],
      env: {},
      shell: false,
    },
    {
      id: 'daemon',
      name: 'Chatroom Daemon',
      cwd: repoRoot,
      command: 'sh',
      args: ['-c', 'pnpm --filter chatroom-cli build && pnpm exec chatroom machine daemon start'],
      env: {
        CHATROOM_CONVEX_URL: convexUrl,
        CHATROOM_WEB_URL: webUrl,
      },
      shell: false,
    },
  ];
}
