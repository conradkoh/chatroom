// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
import type {
  AgentCommandActiveAgent,
  AgentCommandProcessManager,
} from './ports/agent-command-process-manager.js';
import type { AgentFactSink } from './ports/agent-fact-sink.js';
import type {
  AgentStopCommand,
  AgentStopCommandResult,
  AgentStopFailure,
} from '../domain/entities/agent-command.js';
import type { AgentStoppedFact, AgentStoppedOutcome } from '../domain/entities/agent-fact.js';
import { buildAgentStoppedEventId } from '../domain/entities/agent-fact.js';

export interface AgentStopCommandExecutorDependencies {
  readonly processManager: AgentCommandProcessManager;
  readonly factSink: AgentFactSink;
  readonly now?: (() => number) | undefined;
}

export interface AgentStopCommandExecutor {
  stop(command: AgentStopCommand): Promise<AgentStopCommandResult>;
}

interface ResolvedTarget {
  readonly agent: AgentCommandActiveAgent;
  readonly alreadyStopped: boolean;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function compareRoles(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// Resolve a stop command to its machine-local targets. An explicit agent
// target that is not active locally becomes a synthetic already-stopped
// target so the caller can clear the request idempotently. Chatroom targets
// use the backend's concrete target snapshot to distinguish a vanished agent
// from a newly started replacement, while still stopping local ephemeral roles.
function resolveTargets(
  command: AgentStopCommand,
  active: readonly AgentCommandActiveAgent[]
): readonly ResolvedTarget[] {
  const target = command.target;
  if (target.kind === 'agent') {
    const found = active.find(
      (candidate) =>
        candidate.chatroomId === target.chatroomId &&
        normalize(candidate.role) === normalize(target.role)
    );
    if (found !== undefined) return [{ agent: found, alreadyStopped: false }];
    return [
      {
        agent: {
          chatroomId: target.chatroomId,
          role: target.role,
        },
        alreadyStopped: true,
      },
    ];
  }
  const roomActive = active.filter(
    (candidate) => normalize(candidate.chatroomId) === normalize(target.chatroomId)
  );
  const concreteTargets = command.targets ?? [];
  const resolved = concreteTargets.map((requested) => {
    const found = roomActive.find(
      (candidate) =>
        normalize(candidate.role) === normalize(requested.role) && candidate.pid === requested.pid
    );
    return found === undefined
      ? {
          agent: { chatroomId: target.chatroomId, role: requested.role },
          alreadyStopped: true,
        }
      : { agent: found, alreadyStopped: false };
  });
  const requestedRoles = new Set(concreteTargets.map((requested) => normalize(requested.role)));
  const additionalActive = roomActive
    .filter((candidate) => !requestedRoles.has(normalize(candidate.role)))
    .map((agent) => ({ agent, alreadyStopped: false }));
  return [...resolved, ...additionalActive].sort((a, b) =>
    compareRoles(a.agent.role, b.agent.role)
  );
}

function buildStoppedFact(
  command: AgentStopCommand,
  agent: AgentCommandActiveAgent,
  outcome: AgentStoppedOutcome,
  occurredAt: number
): AgentStoppedFact {
  return {
    kind: 'agent.stopped',
    eventId: buildAgentStoppedEventId({
      commandId: command.commandId,
      chatroomId: agent.chatroomId,
      role: agent.role,
    }),
    intentId: command.intentId,
    commandId: command.commandId,
    machineId: command.machineId,
    chatroomId: agent.chatroomId,
    role: agent.role,
    ...(agent.pid === undefined || outcome !== 'stopped' ? {} : { pid: agent.pid }),
    outcome,
    reason: command.reason,
    occurredAt,
  };
}

function toStopInput(
  command: AgentStopCommand,
  agent: AgentCommandActiveAgent
): Parameters<AgentCommandProcessManager['stopAgent']>[0] {
  return {
    chatroomId: agent.chatroomId,
    role: agent.role,
    reason: command.reason,
    ...(agent.pid === undefined ? {} : { pid: agent.pid }),
  };
}

interface TargetOutcome {
  readonly fact?: AgentStoppedFact;
  readonly failure?: AgentStopFailure;
}

// Stop one resolved target. Already-stopped targets emit a fact without
// touching the process manager. Fact sink rejections propagate so the command
// is not acknowledged when the fact was not durably handed off.
async function stopOneTarget(
  processManager: AgentCommandProcessManager,
  factSink: AgentFactSink,
  command: AgentStopCommand,
  target: ResolvedTarget,
  now: () => number
): Promise<TargetOutcome> {
  if (target.alreadyStopped) {
    const fact = buildStoppedFact(command, target.agent, 'already_stopped', now());
    await factSink.append(fact);
    return { fact };
  }
  const outcome = await processManager.stopAgent(toStopInput(command, target.agent));
  if (!outcome.success) {
    return {
      failure: {
        chatroomId: target.agent.chatroomId,
        role: target.agent.role,
        error: outcome.error ?? `failed to stop agent ${target.agent.role}`,
      },
    };
  }
  const fact = buildStoppedFact(command, target.agent, 'stopped', now());
  await factSink.append(fact);
  return { fact };
}

async function stopAllTargets(
  processManager: AgentCommandProcessManager,
  factSink: AgentFactSink,
  command: AgentStopCommand,
  resolved: readonly ResolvedTarget[],
  now: () => number
): Promise<Pick<AgentStopCommandResult, 'facts' | 'failures'>> {
  const facts: AgentStoppedFact[] = [];
  const failures: AgentStopFailure[] = [];
  for (const target of resolved) {
    const outcome = await stopOneTarget(processManager, factSink, command, target, now);
    if (outcome.fact !== undefined) facts.push(outcome.fact);
    if (outcome.failure !== undefined) failures.push(outcome.failure);
  }
  return { facts, failures };
}

export function createAgentStopCommandExecutor(
  deps: AgentStopCommandExecutorDependencies
): AgentStopCommandExecutor {
  const now = deps.now ?? Date.now;

  return {
    stop: async (command) => {
      if (now() > command.deadlineAt) {
        return {
          commandId: command.commandId,
          status: 'expired',
          facts: [],
          failures: [],
        };
      }

      const resolved = resolveTargets(command, deps.processManager.listActive());
      const { facts, failures } = await stopAllTargets(
        deps.processManager,
        deps.factSink,
        command,
        resolved,
        now
      );

      return {
        commandId: command.commandId,
        status: failures.length > 0 ? 'partial_failure' : 'completed',
        facts,
        failures,
      };
    },
  };
}
