import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import { t } from '../../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
} from '../../helpers/integration';

describe('getContextForRole attachment enrichment', () => {
  test('returns snippets and attached messages', async () => {
    const { sessionId } = await createTestSession('context-read-attachments');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    const attachedMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'source',
      type: 'message',
    });
    const messageId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'context message',
        type: 'message',
        attachedMessageIds: [attachedMessageId],
        attachedSnippets: [
          {
            reference: 'attachment-reference-snippet-1',
            fileSource: 'src/a.ts',
            selectedContent: 'const a = 1;',
          },
        ],
      })
    );
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });
    const message = context.messages.find((item) => item._id === messageId);
    expect(message?.attachedSnippets).toHaveLength(1);
    expect(message?.attachedMessages).toHaveLength(1);
  });
});
