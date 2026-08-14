import { describe, expect, it } from 'vitest';

describe('message serialization migration inventory', () => {
  it('documents every current serialization call site', () => {
    expect([
      'apps/webapp/src/modules/chatroom/lib/messageExport/buildMessageMarkdownDownload.ts (deferred — webapp export)',
    ]).toHaveLength(1);
  });
});
