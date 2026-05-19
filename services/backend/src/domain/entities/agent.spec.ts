/**
 * Agent entity — unit tests
 *
 * Validates the multi-shape pattern applied to all 7 domain types
 * in agent.ts. Each domain follows the same structure: source tuple,
 * type, enum object, Convex validator, runtime guard.
 */

import { describe, expect, test } from 'vitest';

import {
  AGENT_HARNESSES,
  AgentHarnessEnum,
  agentHarnessValidator,
  isAgentHarness,
  AGENT_TYPES,
  AgentTypeEnum,
  agentTypeValidator,
  isAgentType,
  MACHINE_COMMAND_TYPES,
  MachineCommandTypeEnum,
  machineCommandTypeValidator,
  isMachineCommandType,
  MACHINE_COMMAND_STATUSES,
  MachineCommandStatusEnum,
  machineCommandStatusValidator,
  isMachineCommandStatus,
  AGENT_START_REASONS,
  AgentStartReasonEnum,
  agentStartReasonValidator,
  isAgentStartReason,
  AGENT_STOP_REASONS,
  AgentStopReasonEnum,
  agentStopReasonValidator,
  isAgentStopReason,
  MODEL_SOURCES,
  ModelSourceEnum,
  modelSourceValidator,
  isModelSource,
} from './agent';

// ─── Helper: parameterized domain test ──────────────────────────────────────

interface DomainSpec {
  label: string;
  values: readonly string[];
  enumObj: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validator: any;
  guard: (value: unknown) => boolean;
}

const domains: DomainSpec[] = [
  {
    label: 'AgentHarness',
    values: AGENT_HARNESSES,
    enumObj: AgentHarnessEnum,
    validator: agentHarnessValidator,
    guard: isAgentHarness,
  },
  {
    label: 'AgentType',
    values: AGENT_TYPES,
    enumObj: AgentTypeEnum,
    validator: agentTypeValidator,
    guard: isAgentType,
  },
  {
    label: 'MachineCommandType',
    values: MACHINE_COMMAND_TYPES,
    enumObj: MachineCommandTypeEnum,
    validator: machineCommandTypeValidator,
    guard: isMachineCommandType,
  },
  {
    label: 'MachineCommandStatus',
    values: MACHINE_COMMAND_STATUSES,
    enumObj: MachineCommandStatusEnum,
    validator: machineCommandStatusValidator,
    guard: isMachineCommandStatus,
  },
  {
    label: 'AgentStartReason',
    values: AGENT_START_REASONS,
    enumObj: AgentStartReasonEnum,
    validator: agentStartReasonValidator,
    guard: isAgentStartReason,
  },
  {
    label: 'AgentStopReason',
    values: AGENT_STOP_REASONS,
    enumObj: AgentStopReasonEnum,
    validator: agentStopReasonValidator,
    guard: isAgentStopReason,
  },
  {
    label: 'ModelSource',
    values: MODEL_SOURCES,
    enumObj: ModelSourceEnum,
    validator: modelSourceValidator,
    guard: isModelSource,
  },
];

describe.each(domains)('$label', ({ label: _label, values, enumObj, validator, guard }) => {
  test('enum has entries for each value', () => {
    for (const v of values) {
      expect(enumObj[v]).toBe(v);
    }
    expect(Object.keys(enumObj)).toHaveLength(values.length);
  });

  test('guard accepts known values', () => {
    for (const v of values) {
      expect(guard(v)).toBe(true);
    }
  });

  test('guard rejects unknown values', () => {
    expect(guard('nonexistent')).toBe(false);
    expect(guard('')).toBe(false);
  });

  test('validator.members stays in sync with source values', () => {
    const members = (validator.members as readonly { value: string }[])
      .map((m) => m.value)
      .slice()
      .sort();
    const source = [...values].slice().sort();
    expect(members).toEqual(source);
  });
});
