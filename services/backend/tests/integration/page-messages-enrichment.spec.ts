import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, joinParticipant } from '../helpers/integration';

describe('conversation.listPageMessages attachment enrichment', () => {
  test('returns snippets and attached messages', async () => {
    const { sessionId } = await createTestSession('page-messages-enrichment');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
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
        content: 'with attachments',
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
    const result = await t.query(api.conversation.listPageMessages, {
      sessionId: sessionId as any,
      chatroomId,
      pageId: messageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: null,
    });
    const enriched = result.page.find((message) => message._id === messageId);
    expect(enriched?.attachedSnippets).toHaveLength(1);
    expect(enriched?.attachedMessages).toHaveLength(1);
  });
});
