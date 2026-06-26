import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageAttachmentChips } from './MessageAttachmentChips';
import type { Message } from '../../types/message';

describe('MessageAttachmentChips', () => {
  it('renders snippet chip with file basename in view mode', () => {
    render(
      <MessageAttachmentChips
        message={{
          _id: 'm1',
          type: 'message',
          senderRole: 'user',
          content: 'hello',
          _creationTime: 1,
          attachedSnippets: [
            {
              reference: 'attachment-reference-001',
              fileSource: './windsurfrules',
              selectedContent: '# Shadcn',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('windsurfrules')).toBeInTheDocument();
  });

  it('returns null when no attachments', () => {
    const message: Message = {
      _id: 'm1',
      type: 'message',
      senderRole: 'user',
      content: 'hello',
      _creationTime: 1,
    };

    const { container } = render(<MessageAttachmentChips message={message} />);
    expect(container.firstChild).toBeNull();
  });
});
