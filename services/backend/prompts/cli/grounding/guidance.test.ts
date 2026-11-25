import { describe, expect, test } from 'vitest';

import { getGroundingPublishGuidance } from './guidance';
import { renderAgenticQuerySystemPrompt } from '../../agentic-query/system-prompt';

describe('getGroundingPublishGuidance', () => {
  test('explains the grounding document and prints the real publish command', () => {
    const guidance = getGroundingPublishGuidance({
      cliEnvPrefix: '',
      chatroomId: 'chat-1',
      role: 'coordinator',
    });

    expect(guidance).toContain('**Grounding document.**');
    expect(guidance).toContain('chatroom grounding view-template');
    expect(guidance).toContain(
      'chatroom grounding publish --chatroom-id="chat-1" --role="coordinator" << \'CHATROOM_GROUNDING_END\''
    );
  });
});

describe('grounding isolation', () => {
  test('the agentic-query prompt never advertises the grounding command group', () => {
    const rendered = renderAgenticQuerySystemPrompt({
      convexUrl: 'http://localhost:3210',
      chatroomId: 'chat-1',
      queryId: 'query-1',
    });

    expect(rendered).not.toContain('chatroom grounding');
  });
});
