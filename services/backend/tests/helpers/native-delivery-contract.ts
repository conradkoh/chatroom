/**
 * Shared assertions for native harness task-delivery prompts.
 */

import { expect } from 'vitest';

export interface NativeDeliveryContractOptions {
  /** Task body expected in the delivery prompt */
  taskContent?: string;
  /** Expected handoff target role */
  handoffTarget?: string;
}

/** Assert a native task delivery prompt matches the slim contract. */
export function assertNativeDeliveryContract(
  output: string,
  options: NativeDeliveryContractOptions = {}
): void {
  expect(output).not.toContain('get-next-task');
  expect(output).not.toMatch(/blocking `get-next-task`/i);
  expect(output).not.toContain('grace-period cooldowns');
  expect(output).not.toContain('Context compacted?');
  expect(output).not.toMatch(/task read --chatroom-id/i);
  expect(output).not.toContain('REQUIRED FIRST STEP: Read the chatroom task');
  expect(output).not.toContain('task injection');
  expect(output).not.toContain('Level A');
  expect(output).not.toContain('Level B');
  expect(output).toContain('<task>');
  expect(output).toContain('<next-steps>');
  expect(output).toContain('you MUST run the handoff command');
  expect(output).toContain('<handoff-templates>');
  expect(output).toContain('<handoffs>');

  if (options.taskContent) {
    expect(output).toContain(options.taskContent);
  }

  if (options.handoffTarget) {
    expect(output).toContain(`**${options.handoffTarget}**`);
    expect(output).toContain(`--next-role="${options.handoffTarget}"`);
  }
}

/** Assert native task delivery includes per-task role guidance and intake. */
export function assertNativeDeliveryRoleGuidance(
  output: string,
  options: { entryPoint?: boolean; role: string; teamId?: string }
): void {
  expect(output).toContain('<role-guidance>');
  if (options.teamId === 'duo' && options.role === 'planner') {
    expect(output).toContain('Planner Operating Model');
    expect(output).toContain('Receive user message');
  }
  if (options.teamId === 'duo' && options.role === 'builder') {
    expect(output).toContain('Builder Operating Model');
  }
  if (options.role === 'solo') {
    expect(output).toContain('Solo Operating Model');
  }
  expect(output).toContain('<task-intake>');
  if (options.entryPoint) {
    expect(output).toContain('Start working');
  }
}

export function assertNativeHandoffOutput(output: string): void {
  expect(output).not.toContain('get-next-task');
  expect(output).not.toContain('task injection');
  expect(output).not.toContain('Level A');
  expect(output).not.toContain('Level B');
}
