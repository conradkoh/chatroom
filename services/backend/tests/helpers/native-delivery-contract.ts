/**
 * Shared assertions for native harness task-delivery / injection prompts.
 */

import { expect } from 'vitest';

export interface NativeDeliveryContractOptions {
  /** Task body expected inside `<task-content>` */
  taskContent?: string;
  /** When true, expect user-message workflow (classify step). */
  fromUser?: boolean;
  /** When true, expect handoff-from-agent workflow. */
  fromAgent?: string;
}

/** Assert a delivery or injection prompt matches the native harness contract. */
export function assertNativeDeliveryContract(
  output: string,
  options: NativeDeliveryContractOptions = {}
): void {
  // Native delivery must not use CLI listen-loop framing (templates may mention CLI harnesses).
  expect(output).not.toMatch(/blocking `get-next-task`/i);
  expect(output).not.toMatch(/A foreground `get-next-task`/i);
  expect(output).not.toContain('No message found');
  expect(output).not.toContain('grace-period cooldowns');
  expect(output).toContain('injected into your native harness session');
  expect(output).toContain('<task-content>');
  expect(output).toContain('next task will be injected automatically');
  expect(output).not.toContain('Context compacted?');
  expect(output).not.toMatch(/Read chatroom task/i);
  expect(output).not.toMatch(/task read --chatroom-id/i);
  expect(output).not.toContain('REQUIRED FIRST STEP: Read the chatroom task');

  if (options.taskContent) {
    expect(output).toContain(options.taskContent);
  }

  if (options.fromUser) {
    expect(output).toContain('From: user');
    expect(output).toContain('Classify');
  }

  if (options.fromAgent) {
    expect(output).toContain(`handed off from ${options.fromAgent}`);
  }
}

/** Assert handoff CLI output for native harnesses. */
export function assertNativeHandoffOutput(output: string): void {
  expect(output).not.toContain('get-next-task');
  expect(output.toLowerCase()).toMatch(/inject/);
}
