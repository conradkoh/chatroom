import { describe, expect, test } from 'vitest';

import { getGroundingReferenceBlock, pairCarriesGroundingReference } from './reference';

describe('pairCarriesGroundingReference', () => {
  test.each([
    { teamId: 'trio', fromRole: 'coordinator', toRole: 'architect', expected: true },
    { teamId: 'duo', fromRole: 'planner', toRole: 'builder', expected: true },
    { teamId: 'solo', fromRole: 'solo', toRole: 'architect', expected: true },
    { teamId: 'trio', fromRole: 'specifier', toRole: 'builder', expected: true },
    { teamId: 'trio', fromRole: 'coordinator', toRole: 'user', expected: false },
    { teamId: 'trio', fromRole: 'architect', toRole: 'coordinator', expected: false },
    { teamId: 'trio', fromRole: 'builder', toRole: 'specifier', expected: false },
    { teamId: 'trio', fromRole: 'specifier', toRole: 'coordinator', expected: false },
    { teamId: 'duo', fromRole: 'builder', toRole: 'planner', expected: false },
  ])('$teamId:$fromRole->$toRole is $expected', ({ expected, ...pair }) => {
    expect(pairCarriesGroundingReference(pair)).toBe(expected);
  });
});

describe('getGroundingReferenceBlock', () => {
  test('names the read command for the recipient and describes the document neutrally', () => {
    const block = getGroundingReferenceBlock({ chatroomId: 'chat-1', toRole: 'architect' });

    expect(block).toContain('Grounding ID: <groundingId>, or `None.`');
    expect(block).toContain(
      'Read it: `chatroom grounding read --chatroom-id="chat-1" --role="architect" --grounding-id="<groundingId>"`'
    );
    expect(block).toContain('It records factual observations from an earlier pass.');
  });

  test('falls back to the chatroom-id placeholder when no id is supplied', () => {
    const block = getGroundingReferenceBlock({ toRole: 'builder' });

    expect(block).toContain('chatroom grounding read --chatroom-id="<chatroom-id>"');
  });
});
