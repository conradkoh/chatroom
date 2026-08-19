import { describe, expect, test } from 'vitest';

import {
  appendTaskDeliveryEnhancerGuidance,
  appendTaskDeliveryEnhancerInputGuidance,
} from './enhancer-guidance';
import {
  ENHANCER_ENABLED_USER_WORKFLOW,
  ENHANCER_REQUEST_FIRST_WORKFLOW,
} from '../../src/domain/usecase/enhancer/enhancer-workflow';

describe('appendTaskDeliveryEnhancerGuidance', () => {
  test('requires an immediate, request-only, one-time enhancer handoff', () => {
    const lines: string[] = [];
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('First action after required task-intake/context setup');
    expect(output).toContain('Do not research, plan, or draft');
    expect(output).toContain('stripped-down');
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
    appendTaskDeliveryEnhancerGuidance(lines);
    const output = lines.join('\n');
    expect(output).toContain(ENHANCER_ENABLED_USER_WORKFLOW);
    expect(output).toContain(ENHANCER_REQUEST_FIRST_WORKFLOW);
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
    expect(output).toContain('Enhancer Planning Input');
    expect(output).toContain('first planning input');
    expect(output).toContain('not as a review of a planner-authored draft');
    expect(output).toContain(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room_1" --role="planner"'
    );
    expect(output).toContain('delegate to `builder`');
    expect(output).toContain('advisory');
    expect(output).toContain('final call');
    expect(output).toContain('One enhancer pass per originating user message');
    expect(output).toContain('</enhancer-input>');
  });
});
