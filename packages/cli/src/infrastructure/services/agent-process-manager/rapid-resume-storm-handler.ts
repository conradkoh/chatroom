import type { ResumeStormReason } from '@workspace/backend/src/domain/entities/resume-storm.js';

import type { AgentSlot } from './agent-process-manager.js';
import { api } from '../../../api.js';
import { classifyResumeStormReason } from '../../../domain/agent-lifecycle/index.js';
import type {
  RapidResumeCheckResult,
  RapidResumeTracker,
} from '../../machine/rapid-resume-tracker.js';
import type { AgentHarness } from '../../machine/types.js';

export interface ResumeStormHandlerDeps {
  sessionId: string;
  machineId: string;
  backend: {
    mutation: (name: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

const RECENT_LOG_LINE_CAP = 100;

export function appendRecentLogLine(slot: AgentSlot, line: string): void {
  if (!slot.recentLogLines) {
    slot.recentLogLines = [];
  }
  slot.recentLogLines.push(line);
  if (slot.recentLogLines.length > RECENT_LOG_LINE_CAP) {
    slot.recentLogLines.shift();
  }
}

// fallow-ignore-next-line complexity
async function abortResumeStorm(
  deps: ResumeStormHandlerDeps,
  opts: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
    stormCheck: RapidResumeCheckResult;
    reason: ResumeStormReason;
    slot?: AgentSlot;
    stop: (args: {
      chatroomId: string;
      role: string;
      reason: 'platform.resume_storm';
    }) => Promise<{ success: boolean }>;
  }
): Promise<void> {
  console.log(
    `[AgentProcessManager] rapid resume storm: role=${opts.role} reason=${opts.reason} ` +
      `ends=${opts.stormCheck.endCount}/${opts.stormCheck.threshold} in ${opts.stormCheck.windowMs}ms`
  );

  try {
    await deps.backend.mutation(api.agentResumeStorm.emitResumeStormAborted, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      chatroomId: opts.chatroomId,
      role: opts.role,
      reason: opts.reason,
      endCount: opts.stormCheck.endCount,
      windowMs: opts.stormCheck.windowMs,
      ...(opts.slot?.harnessSessionId ? { harnessSessionId: opts.slot.harnessSessionId } : {}),
    });
    console.log(`[AgentProcessManager] ✅ Emitted agent.resumeStormAborted for ${opts.role}`);
  } catch (err) {
    console.log(`   ⚠️  Failed to emit resumeStormAborted event: ${(err as Error).message}`);
  }

  if (opts.slot?.state === 'running' && opts.slot.pid === opts.pid) {
    await opts.stop({
      chatroomId: opts.chatroomId,
      role: opts.role,
      reason: 'platform.resume_storm',
    });
  }
}

function classifyStormReasonFromSlot(slot: AgentSlot | undefined): ResumeStormReason {
  return classifyResumeStormReason(slot?.recentLogLines ?? []);
}

export async function maybeAbortResumeStorm(
  tracker: RapidResumeTracker,
  deps: ResumeStormHandlerDeps,
  opts: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
  },
  slot: AgentSlot | undefined,
  now: number,
  stop: (args: {
    chatroomId: string;
    role: string;
    reason: 'platform.resume_storm';
  }) => Promise<{ success: boolean }>
): Promise<boolean> {
  const stormCheck = tracker.record(opts.chatroomId, opts.role, now);
  if (!stormCheck.isStorm) {
    return false;
  }

  tracker.reset(opts.chatroomId, opts.role);
  if (slot) {
    slot.resumeInFlight = false;
  }

  await abortResumeStorm(deps, {
    ...opts,
    stormCheck,
    reason: classifyStormReasonFromSlot(slot),
    slot,
    stop,
  });
  return true;
}
