import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentMarkdownModal } from './AttachmentMarkdownModal';
import { backlogProseClassNames } from '../../components/markdown-utils';

vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const LONG_PATH =
  'apps/webapp/src/modules/chatroom/workspace/components/some/very/deep/nested/path/ThatIsWayTooLongForOneLineWithoutWrapping.ts';

describe('AttachmentMarkdownModal', () => {
  it('wraps long file paths instead of forcing horizontal scroll container', () => {
    const { container } = render(
      <AttachmentMarkdownModal
        isOpen
        onClose={() => {}}
        title="Attached Task"
        content={`\`${LONG_PATH}\``}
        proseClassName={backlogProseClassNames}
      />
    );
    expect(screen.getByText(LONG_PATH)).toBeInTheDocument();
    const proseRoot = container.querySelector('.overflow-x-hidden');
    expect(proseRoot).toBeTruthy();
    expect(proseRoot?.className).toMatch(/break-words/);
  });
});
