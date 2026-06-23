/**
 * Shared assertions for native harness init / system prompts.
 */

import { expect } from 'vitest';

export interface NativeInitContractOptions {
  /** Entry-point role (solo, planner) — native workflow intake wording */
  entryPoint?: boolean;
  /** Solo team role guidance — no CLI classification note with task read */
  soloTeam?: boolean;
  /** Disallow task read CLI patterns (entry-point solo/planner workflows) */
  noTaskRead?: boolean;
}

/** Assert an init/system prompt matches the native slim contract. */
export function assertNativeInitContract(
  prompt: string,
  options: NativeInitContractOptions = {}
): void {
  expect(prompt).not.toMatch(/run `get-next-task`/i);
  expect(prompt).not.toContain('get-next-task');
  expect(prompt).not.toContain('Level A');
  expect(prompt).not.toContain('Level B');
  expect(prompt).not.toContain('Two-Level Model');
  expect(prompt).not.toContain('## Getting Started');
  expect(prompt).not.toContain('task injection');
  expect(prompt).not.toContain('injected automatically');
  expect(prompt).not.toContain('listen-loop');

  if (options.entryPoint) {
    expect(prompt).toContain('Receive user message');
    expect(prompt).toContain('Hand off when complete');
  }

  if (options.soloTeam) {
    expect(prompt).not.toContain('Classification (Entry Point Role)');
    expect(prompt).toContain('Solo Workflow');
  }

  if (options.noTaskRead) {
    expect(prompt).not.toMatch(/task read/i);
  }
}
