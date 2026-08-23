import { describe, expect, test } from 'vitest';

import {
  appendTaskDeliveryEnhancerGuidance,
  appendTaskDeliveryEnhancerInputGuidance,
} from './enhancer-guidance';
import {
  getEnhancerEnabledUserWorkflow,
  getEnhancerRequestFirstWorkflow,
} from '../../src/domain/usecase/enhancer/enhancer-workflow';

const PLANNER_WORKFLOW = { entryPointRole: 'planner', hasBuilder: true };

describe('appendTaskDeliveryEnhancerGuidance', () => {
  test('requires an immediate, request-only, one-time enhancer handoff', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines, PLANNER_WORKFLOW);
    const output = lines.join('\n');

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('First action after required task-intake/context setup');
    expect(output).toContain('Do not research, plan, or draft');
    expect(output).toContain('goal');
    expect(output).toContain('context');
    expect(output).toContain('recommended design');
    expect(output).toContain('one-time per originating user message');
    expect(output).toContain('origin user message ID');
    expect(output).toContain('memoryless enhancer');
    expect(output).toContain('first planning input');
    expect(output).not.toContain('<grounding>');
    expect(output).not.toContain('<builder-handoff>');
    expect(output).not.toContain('per builder delegation');
    expect(output).toContain('get-next-task');
    expect(output).toContain('End your turn immediately');
    expect(output).toContain('monitor the enhancer');
    expect(output).toContain('</handoff-enhancer>');
  });

  test('emits request-first workflow constants verbatim', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines, PLANNER_WORKFLOW);
    const output = lines.join('\n');
    expect(output).toContain(getEnhancerEnabledUserWorkflow('planner', true));
    expect(output).toContain(getEnhancerRequestFirstWorkflow('planner'));
  });
});

describe('appendTaskDeliveryEnhancerInputGuidance', () => {
  test('tells planner to use enhancer output as its first planning input', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerInputGuidance(lines, {
      chatroomId: 'room_1',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });
    const output = lines.join('\n');

    expect(output).toContain('<enhancer-input>');
    expect(output).toContain('Enhancer Design Input');
    expect(output).toContain('first planning input');
    expect(output).toContain('not as a review of an entry-point-authored draft');
    expect(output).toContain(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room_1" --role="planner"'
    );
    expect(output).toContain('implement, delegate, or hand off to `user`');
    expect(output).toContain('advisory');
    expect(output).toContain('verify and delegate');
    expect(output).toContain('One enhancer pass per originating user message');
    expect(output).toContain('</enhancer-input>');
  });
});
