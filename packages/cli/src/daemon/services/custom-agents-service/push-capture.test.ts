/**
 * CLI half of the daemon replay: run the real loader and the real service over a
 * temp workspace, capture the exact `syncDefinitions` args, and pin them to a
 * committed fixture that the backend replays.
 *
 * Machine-specific values are replaced with fixed placeholders so the fixture
 * carries no session id and no absolute path:
 * - `sessionId` → `fixture-session`
 * - `machineId` → `fixture-machine`
 * - `workingDir` → `/test/custom-agent-daemon`
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FunctionArgs } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCustomAgentsService } from './build-custom-agents-service.js';
import type { api } from '../../../api.js';
import type { ConvexClient } from '../../entry/daemon-types.js';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;

const FIXTURE_SESSION_ID = 'fixture-session';
const FIXTURE_MACHINE_ID = 'fixture-machine';
const FIXTURE_WORKING_DIR = '/test/custom-agent-daemon';
const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../services/backend/convex/testdata/custom-agent-daemon-push.json'
);

/** Strip everything machine-specific; what remains is portable across machines. */
function toFixture(args: SyncArgs): SyncArgs {
  return {
    ...args,
    sessionId: FIXTURE_SESSION_ID as SyncArgs['sessionId'],
    machineId: FIXTURE_MACHINE_ID,
    workingDir: FIXTURE_WORKING_DIR,
  };
}

async function readFixture(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

describe('daemon push capture', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'custom-agents-capture-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('captures the workspace push that the backend replays', async () => {
    const workspace = join(dir, 'workspace');
    const agentDir = join(workspace, '.chatroom', 'agents', 'x');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, 'AGENT.md'),
      [
        '---',
        'name: x',
        'description: X role.',
        '---',
        'You are x.',
        '',
        'Hand off to the planner when the review is complete.',
      ].join('\n'),
      'utf8'
    );
    await writeFile(join(agentDir, 'inbound-handoff.md'), '## Task\n\nHand this to x.\n', 'utf8');
    await writeFile(join(agentDir, 'return-handoff.md'), '## Summary\n\nX reports back.\n', 'utf8');

    const calls: SyncArgs[] = [];
    const convex = {
      mutation: async (_endpoint: unknown, args: SyncArgs) => {
        calls.push(args);
        return { applied: true, rejected: [] };
      },
    } as unknown as ConvexClient;
    const handlers: ((dirs: readonly string[]) => void)[] = [];
    const membership = {
      subscribe: (fn: (dirs: readonly string[]) => void) => {
        handlers.push(fn);
        return () => {
          handlers.splice(handlers.indexOf(fn), 1);
        };
      },
    };

    const built = buildCustomAgentsService({
      membership,
      machineId: 'machine-capture',
      sessionId: 'session-capture',
      convex,
      log: () => undefined,
      homeDir: join(dir, 'home'),
      statePath: join(dir, 'custom-agents-disabled.json'),
    });
    built.service.start();
    for (const handler of [...handlers]) handler([workspace]);

    await vi.waitFor(() => expect(calls.some((call) => call.scope === 'workspace')).toBe(true), {
      timeout: 5_000,
    });
    built.stopPoll();
    await built.service.stopAll();

    const captured = toFixture(calls.find((call) => call.scope === 'workspace') as SyncArgs);
    const fixture = await readFixture();

    if (fixture === null) {
      if (process.env.CUSTOM_AGENT_WRITE_FIXTURE !== '1') {
        throw new Error(
          `Missing fixture ${FIXTURE_PATH}. Re-run with CUSTOM_AGENT_WRITE_FIXTURE=1 to create it.`
        );
      }
      await mkdir(dirname(FIXTURE_PATH), { recursive: true });
      await writeFile(FIXTURE_PATH, `${JSON.stringify(captured, null, 2)}\n`, 'utf8');
      return;
    }

    expect(captured).toEqual(fixture);
  });
});
