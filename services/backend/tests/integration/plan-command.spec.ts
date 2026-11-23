// @vitest-environment node
/**
 * Plan CLI end-to-end
 *
 * Drives the real `plan publish` → `plan read [--phase]` command code against
 * the convex-test backend. Only the BackendService/SessionService ports are
 * substituted (with convex-test calls), so the effect pipeline, pre-validation,
 * output formatting and error handling all run for real.
 */
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { publishPlan } from '../../../../packages/cli/src/commands/plan/publish.js';
import { readPlan } from '../../../../packages/cli/src/commands/plan/read.js';
import type { ConvexCommandDeps } from '../../../../packages/cli/src/infrastructure/deps/create-convex-command-deps.js';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

const PLAN_MARKDOWN = [
  '# CLI plan',
  '',
  '## Sources',
  '- user-request-1',
  '',
  '## Requirements',
  '- Ship the CLI.',
  '',
  '## Constraints',
  '- None.',
  '',
  '## Phases',
  '- P1 — First',
  '- P2 — Second',
  '',
  '## Phase details',
  '',
  '### P1 — First',
  '',
  '#### Requirements',
  '- P1 requirement.',
  '',
  '#### Constraints',
  '- None.',
  '',
  '#### Acceptance criteria',
  '- P1 acceptance.',
  '',
  '### P2 — Second',
  '',
  '#### Depends on',
  '- P1',
  '',
  '#### Requirements',
  '- P2 requirement.',
  '',
  '#### Constraints',
  '- None.',
  '',
  '#### Acceptance criteria',
  '- P2 acceptance.',
].join('\n');

/** Seed the user-origin message + in-progress task `plan publish` requires. */
async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const userMessageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'Plan the CLI',
      targetRole: 'builder',
      type: 'message',
      acknowledgedAt: Date.now(),
    });
    const now = Date.now();
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Plan the CLI',
      status: 'in_progress',
      assignedTo: 'builder',
      sourceMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    });
  });
}

function makeDeps(sessionId: SessionId): ConvexCommandDeps {
  return {
    backend: {
      mutation: (endpoint, args) => t.mutation(endpoint, args),
      query: (endpoint, args) => t.query(endpoint, args),
    },
    session: {
      getSessionId: async () => sessionId,
      getConvexUrl: () => 'https://test.convex.cloud',
      getOtherSessionUrls: async () => [],
    },
  };
}

async function setup(suffix: string) {
  const { sessionId } = await createTestSession(`plan-cli-${suffix}`);
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, 'planner');
  await joinParticipant(sessionId, chatroomId, 'builder');
  await seedActiveTask(chatroomId);
  return { sessionId, chatroomId, deps: makeDeps(sessionId) };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stdout(): string {
  return logSpy.mock.calls.map((call) => (call as unknown[]).join(' ')).join('\n');
}

function stderr(): string {
  return errorSpy.mock.calls.map((call) => (call as unknown[]).join(' ')).join('\n');
}

describe('plan CLI end-to-end', () => {
  test('publishes a real plan, reads it back exactly, then reads one phase', async () => {
    const { chatroomId, deps } = await setup('roundtrip');

    await publishPlan(chatroomId, { role: 'builder', content: PLAN_MARKDOWN }, deps);
    const published = stdout();
    expect(published).toContain('✅ Plan published');
    expect(published).toContain('Phases: P1, P2');

    const planId = /Plan ID: (\S+)/.exec(published)?.[1];
    expect(planId).toBeTruthy();

    await readPlan(chatroomId, { role: 'builder', planId: planId! }, deps);
    expect(stdout()).toContain(PLAN_MARKDOWN);

    const beforePhase = stdout().length;
    await readPlan(chatroomId, { role: 'builder', planId: planId!, phase: 'P2' }, deps);
    const phaseOutput = stdout().slice(beforePhase);
    expect(phaseOutput).toContain('- **P2 — Second** (selected phase)');
    expect(phaseOutput).toContain('### P2 — Second');
    expect(phaseOutput).not.toContain('### P1 — First');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('an absent phase exits 1 and lists the available ids', async () => {
    const { chatroomId, deps } = await setup('missing-phase');
    await publishPlan(chatroomId, { role: 'builder', content: PLAN_MARKDOWN }, deps);
    const planId = /Plan ID: (\S+)/.exec(stdout())?.[1];

    await readPlan(chatroomId, { role: 'builder', planId: planId!, phase: 'P9' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('P9');
    expect(stderr()).toContain('P1, P2');
  });

  test('an over-limit plan exits 1 with the PLAN_TOO_LONG line and publishes nothing', async () => {
    const { chatroomId, deps } = await setup('too-long');

    await publishPlan(chatroomId, { role: 'builder', content: 'x'.repeat(40_001) }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain(
      'line 1: PLAN_TOO_LONG — Plan must be 40000 characters or less (got 40001)'
    );
    expect(stdout()).not.toContain('✅ Plan published');
  });

  test('a malformed plan id reports PLAN_NOT_FOUND', async () => {
    const { chatroomId, deps } = await setup('not-found');

    await readPlan(chatroomId, { role: 'builder', planId: 'not-a-plan-id' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Plan not found');
  });
});
