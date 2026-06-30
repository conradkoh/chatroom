/**
 * Shared assertions for native harness init / system prompts.
 */

import { expect } from 'vitest';

import { SKILLS_REGISTRY } from '../../src/domain/usecase/skills/registry';

export interface NativeInitContractOptions {
  /** Solo team — operating model lives in task delivery, not init */
  soloTeam?: boolean;
  /** Disallow task read CLI patterns (entry-point solo/planner workflows) */
  noTaskRead?: boolean;
  /** When set, assert init prompt length stays below this budget */
  maxLength?: number;
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

  expect(prompt).not.toContain('## Planner Operating Model');
  expect(prompt).not.toContain('## Builder Operating Model');
  expect(prompt).not.toContain('## Solo Operating Model');
  expect(prompt).not.toContain('Delegate ONE phase');
  expect(prompt).not.toMatch(/### Start [Ww]orking/);
  expect(prompt).not.toContain('**Proactively activate skills**');
  if (SKILLS_REGISTRY.length > 0) {
    expect(prompt).not.toContain(`- **${SKILLS_REGISTRY[0].skillId}**:`);
  }

  if (options.soloTeam) {
    expect(prompt).not.toContain('Classification (Entry Point Role)');
    expect(prompt).not.toContain('chatroom classify');
    expect(prompt).not.toContain('Solo Operating Model');
  }

  expect(prompt).not.toContain('chatroom classify');
  expect(prompt).not.toMatch(/Classify with classify/i);

  if (options.noTaskRead) {
    expect(prompt).not.toMatch(/task read --chatroom-id/i);
  }

  if (options.maxLength !== undefined) {
    expect(prompt.length).toBeLessThan(options.maxLength);
  }
}
