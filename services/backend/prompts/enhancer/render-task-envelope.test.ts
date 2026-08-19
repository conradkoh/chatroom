import { describe, expect, it } from 'vitest';

import { renderEnhancerTaskEnvelope } from './render-task-envelope';
import { getEnhancerToPlannerHandoffTemplate } from '../teams/duo/handoff-templates/enhancer-to-planner.js';

describe('renderEnhancerTaskEnvelope', () => {
  const params = {
    jobId: 'job-123',
    chatroomId: 'room-abc',
    originUserMessageId: 'message-origin',
    outputTemplateContent: '# Independent planning input',
    requestContent: '<request>Change the workflow</request>',
    cliCompleteCommand:
      "chatroom enhancer complete --chatroom-id=room-abc --job-id=job-123 << 'CHATROOM_ENHANCER_END'",
  };

  it('identifies the job, chatroom, and originating user message', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('job-id="job-123"');
    expect(result).toContain('chatroom-id="room-abc"');
    expect(result).toContain('origin-user-message-id="message-origin"');
  });

  it('contains only the output contract and stripped forwarded request', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('<output-template>');
    expect(result).toContain('# Independent planning input');
    expect(result).toContain('<forwarded-request>');
    expect(result).toContain('&lt;request&gt;Change the workflow&lt;/request&gt;');
    expect(result).not.toContain('<handoff-templates>');
    expect(result).not.toContain('<references>');
    expect(result).not.toContain('<planner-check-in>');
    expect(result).not.toContain('planner-&gt;builder');
    expect(result).not.toContain('planner-&gt;user');
  });

  it('requires independent investigation and authoritative message history', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Download chatroom history from the origin user message');
    expect(result).toContain('actual user messages are authoritative');
    expect(result).toContain('Investigate the repository independently');
    expect(result).not.toContain('planner research');
    expect(result).not.toContain('planner draft');
    expect(result).not.toContain('builder delegation');
    expect(result).not.toContain('user-report');
  });

  it('contains completion and output-order requirements', () => {
    const result = renderEnhancerTaskEnvelope(params);
    expect(result).toContain('Single-turn only. No subagents. Do not implement changes.');
    expect(result).toContain('optional **UX** section');
    expect(result).toContain('optional **Defragmentation** section');
    expect(result).toContain('**Implementation notes** must be last');
    expect(result).toContain('<cli-complete-command>');
  });

  it('embeds the enhancer planning-input template and its UX catalog', () => {
    const result = renderEnhancerTaskEnvelope({
      ...params,
      outputTemplateContent: getEnhancerToPlannerHandoffTemplate(),
    });
    expect(result).toContain('Planning Input (Enhancer → Planner)');
    expect(result).toContain('no layout shift');
    expect(result).toContain('**Interaction affordance**');
  });
});
