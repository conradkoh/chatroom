import { describe, expect, it } from 'vitest';

describe('message serialization migration inventory', () => {
  it('documents every current serialization call site', () => {
    expect([
      'packages/cli/src/commands/messages/messages-fs-service.ts (buildLinearMessageContent, buildMessageMarkdown)',
      'packages/cli/src/commands/messages/download.ts',
      'packages/cli/src/commands/context/index.ts',
      'services/backend/prompts/task-delivery/render-task-envelope.ts (renderOriginMessageBlock)',
      'apps/webapp/src/modules/chatroom/lib/messageExport/buildMessageMarkdownDownload.ts',
      'services/backend queries: listSinceMessage, getContextForRole',
    ]).toHaveLength(6);
  });
});
