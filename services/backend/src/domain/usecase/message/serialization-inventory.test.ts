import { describe, expect, it } from 'vitest';

describe('message serialization migration inventory', () => {
  it('documents every current serialization call site', () => {
    expect([
      'services/backend/prompts/task-delivery/render-task-envelope.ts (task-origin header)',
      'packages/cli/src/commands/context/index.ts (context-xml profile)',
      'packages/cli/src/commands/messages/download.ts (linear profile)',
      'apps/webapp/src/modules/chatroom/lib/messageExport/buildMessageMarkdownDownload.ts (deferred — webapp export)',
    ]).toHaveLength(4);
  });
});
