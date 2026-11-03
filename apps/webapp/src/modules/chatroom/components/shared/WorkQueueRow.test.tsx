import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkQueueRow } from './WorkQueueRow';

function renderRow(
  overrides: {
    meta?: React.ReactNode;
    attachments?: React.ReactNode;
    onOpen?: () => void;
  } = {}
) {
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <WorkQueueRow
      preview={<span>Queued preview</span>}
      meta={overrides.meta}
      attachments={overrides.attachments}
      actions={
        <button type="button" data-testid="row-action">
          Action
        </button>
      }
      onOpen={onOpen}
    />
  );
  return { onOpen };
}

function rowElement(): HTMLElement {
  return screen.getByText('Queued preview').closest('[role="button"]') as HTMLElement;
}

describe('WorkQueueRow', () => {
  it('opens on a row click', () => {
    const { onOpen } = renderRow();

    fireEvent.click(rowElement());

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens on Enter and Space', () => {
    const { onOpen } = renderRow();

    fireEvent.keyDown(rowElement(), { key: 'Enter' });
    fireEvent.keyDown(rowElement(), { key: ' ' });

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does not open from a click on an action', () => {
    const { onOpen } = renderRow();

    fireEvent.click(screen.getByTestId('row-action'));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not open from a click on an attachment', () => {
    const { onOpen } = renderRow({
      attachments: (
        <button type="button" data-testid="attachment">
          Attachment
        </button>
      ),
    });

    fireEvent.click(screen.getByTestId('attachment'));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders meta and attachments only when provided', () => {
    renderRow({ meta: <span>12s</span>, attachments: <span>chip</span> });
    expect(screen.getByText('12s')).toBeDefined();
    expect(screen.getByText('chip')).toBeDefined();
  });

  it('omits meta and attachments when not provided', () => {
    renderRow();

    expect(screen.queryByText('12s')).toBeNull();
    expect(screen.queryByText('chip')).toBeNull();
    expect(rowElement().querySelectorAll('p')).toHaveLength(0);
  });
});
