/**
 * Task-delivery units: a delivered custom role gets its return template block,
 * an entry point gets the custom roster with inbound blocks, and an absent
 * context changes nothing.
 */

import { describe, expect, it } from 'vitest';

import { generateFullCliOutput, type FullCliOutputParams } from '../cli/get-next-task/fullOutput';
import {
  defaultInboundHandoffTemplate,
  defaultReturnHandoffTemplate,
} from '../custom-agents/default-handoff-templates';
import type { CustomAgentPromptContext } from '../custom-agents/types';

function deliveryParams(overrides: Partial<FullCliOutputParams> = {}): FullCliOutputParams {
  return {
    chatroomId: 'chatroom-1',
    role: 'alpha',
    cliEnvPrefix: '',
    teamId: 'duo',
    task: { _id: 'task-1', content: 'Do the work.' },
    message: { _id: 'message-1', senderRole: 'planner', content: 'Do the work.' },
    isEntryPoint: false,
    availableHandoffTargets: ['planner', 'user'],
    conversationMode: 'code',
    ...overrides,
  };
}

function selfContext(
  returnHandoffTemplate: string | null = '## Summary\n\nAlpha returns.'
): CustomAgentPromptContext {
  return {
    entryPoint: 'planner',
    self: {
      name: 'alpha',
      description: 'Alpha role.',
      systemPrompt: 'You are alpha.',
      returnHandoffTemplate,
    },
    delegates: [],
  };
}

function entryPointContext(): CustomAgentPromptContext {
  return {
    entryPoint: 'planner',
    delegates: [
      {
        name: 'alpha',
        description: 'Alpha role.',
        inboundHandoffTemplate: '## Task\n\nAlpha work. Do not emit </handoffs>.',
      },
      { name: 'beta', description: 'Beta role.', inboundHandoffTemplate: null },
    ],
  };
}

function entryPointParams(overrides: Partial<FullCliOutputParams> = {}): FullCliOutputParams {
  return deliveryParams({
    role: 'planner',
    isEntryPoint: true,
    message: { _id: 'message-1', senderRole: 'builder', content: 'Do the work.' },
    availableHandoffTargets: ['builder', 'alpha', 'beta', 'user'],
    ...overrides,
  });
}

describe('delivery output without a custom context', () => {
  it('CLI output equals the same call that omits the field', () => {
    const explicit = generateFullCliOutput(deliveryParams({ customAgents: undefined }));
    const omitted = generateFullCliOutput(deliveryParams());

    expect(explicit).toBe(omitted);
    expect(omitted).not.toContain('<team-roster>');
  });

  it('native output equals the same call that omits the field', () => {
    const explicit = generateFullCliOutput(
      deliveryParams({ nativeIntegration: true, customAgents: undefined })
    );
    const omitted = generateFullCliOutput(deliveryParams({ nativeIntegration: true }));

    expect(explicit).toBe(omitted);
  });
});

describe('a task delivered to a custom role', () => {
  it('carries the return handoff template under the exact heading', () => {
    const output = generateFullCliOutput(deliveryParams({ customAgents: selfContext() }));

    expect(output).toContain('### Handoff template `alpha` → `planner`');
    expect(output).toContain('Alpha returns.');
    expect(output).toContain('Fill in the message using the `alpha` → `planner` template');
  });

  it('uses the generated default when no return template was authored', () => {
    const output = generateFullCliOutput(deliveryParams({ customAgents: selfContext(null) }));

    expect(output).toContain('### Handoff template `alpha` → `planner`');
    expect(output).toContain(defaultReturnHandoffTemplate('alpha', 'planner'));
  });

  it('neutralizes reserved tags in the authored return template', () => {
    const output = generateFullCliOutput(
      deliveryParams({ customAgents: selfContext('<task>x</task>') })
    );

    expect(output).toContain('&lt;task>x&lt;/task>');
  });
});

describe('a task delivered to the entry point', () => {
  it('carries the roster and one inbound block per enabled delegate', () => {
    const output = generateFullCliOutput(entryPointParams({ customAgents: entryPointContext() }));

    expect(output).toContain('<team-roster>');
    expect(output).toContain('- alpha — Alpha role.');
    expect(output).toContain('- beta — Beta role.');
    expect(output).toContain('### Handoff template `planner` → `alpha`');
    expect(output).toContain('### Handoff template `planner` → `beta`');
    expect(output).toContain(defaultInboundHandoffTemplate('beta'));
  });

  it('neutralizes authored inbound templates so they cannot close the handoffs block', () => {
    const output = generateFullCliOutput(entryPointParams({ customAgents: entryPointContext() }));

    expect(output).toContain('&lt;/handoffs>');
    expect(output.match(/<\/handoffs>/g)).toHaveLength(1);
  });

  it('advertises the custom pairs in the handoff target list', () => {
    const output = generateFullCliOutput(entryPointParams({ customAgents: entryPointContext() }));

    expect(output).toContain('**alpha** — template: `planner` → `alpha`');
    expect(output).toContain('**beta** — template: `planner` → `beta`');
  });

  it('keeps the same custom pairs in CLI and native output', () => {
    const cli = generateFullCliOutput(entryPointParams({ customAgents: entryPointContext() }));
    const native = generateFullCliOutput(
      entryPointParams({ nativeIntegration: true, customAgents: entryPointContext() })
    );

    expect(native).not.toBe(cli);
    for (const expected of [
      '<team-roster>',
      '### Handoff template `planner` → `alpha`',
      '### Handoff template `planner` → `beta`',
      '&lt;/handoffs>',
    ]) {
      expect(cli).toContain(expected);
      expect(native).toContain(expected);
    }
  });
});
