import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('../../../', import.meta.url));
const serviceRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const transportImplementations = [
  fileURLToPath(new URL('../../../infrastructure/convex/agent-command-inbox.ts', import.meta.url)),
  fileURLToPath(
    new URL('../../../infrastructure/outbox/agent-command-fact-outbox.ts', import.meta.url)
  ),
  fileURLToPath(
    new URL('../../../infrastructure/outbox/agent-command-fact-send.ts', import.meta.url)
  ),
];
const forbidden = [
  'agent-command-inbox',
  'agent-command-fact-outbox',
  'agent-command-fact-send',
  'agent-command-inbox-consumer',
  'AgentCommandInbox',
  'AgentCommandFactOutbox',
  'AgentCommandFactSend',
  'startAgentCommandInboxConsumer',
];

function listSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (path === serviceRoot || path.startsWith(`${serviceRoot}/`)) return [];
    if (transportImplementations.includes(path)) return [];
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('agent command service boundary', () => {
  it('keeps inbox and outbox transport private to the service package', () => {
    for (const file of listSourceFiles(daemonRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const identifier of forbidden)
        expect(source, `${file} must not reference ${identifier}`).not.toContain(identifier);
    }
  });
});
