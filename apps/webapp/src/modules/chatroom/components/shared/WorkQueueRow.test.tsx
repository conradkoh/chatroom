import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkQueueRow } from './WorkQueueRow';

function renderRow(
  overrides: {
    meta?: React.ReactNode;
    attachments?: React.ReactNode;
    leading?: React.ReactNode;
    onOpen?: () => void;
  } = {}
) {
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <WorkQueueRow
      preview={<span>Queued preview</span>}
      meta={overrides.meta}
      attachments={overrides.attachments}
      leading={overrides.leading}
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

  it('does not open from Enter on an action', () => {
    const { onOpen } = renderRow();

    fireEvent.keyDown(screen.getByTestId('row-action'), { key: 'Enter' });

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

  it('does not open from Space on an attachment', () => {
    const { onOpen } = renderRow({
      attachments: (
        <button type="button" data-testid="attachment">
          Attachment
        </button>
      ),
    });

    fireEvent.keyDown(screen.getByTestId('attachment'), { key: ' ' });

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

  it('renders a leading control before the preview and isolates its clicks', () => {
    const onOpen = vi.fn();
    const onLeadingClick = vi.fn();
    render(
      <WorkQueueRow
        preview={<span>Queued preview</span>}
        actions={<span>Action</span>}
        onOpen={onOpen}
        leading={
          <button type="button" data-testid="row-leading" onClick={onLeadingClick}>
            Handle
          </button>
        }
      />
    );

    const leading = screen.getByTestId('row-leading');
    const preview = screen.getByText('Queued preview');

    expect(
      leading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(leading);

    expect(onLeadingClick).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not open the row from Space on the leading control', () => {
    const { onOpen } = renderRow({
      leading: (
        <span role="button" tabIndex={0} data-testid="row-leading">
          Handle
        </span>
      ),
    });

    fireEvent.keyDown(screen.getByTestId('row-leading'), { key: ' ' });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('spreads rootProps data attributes and drag handlers onto the root', () => {
    const onDragOver = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();
    render(
      <WorkQueueRow
        preview={<span>Queued preview</span>}
        actions={<span>Action</span>}
        onOpen={vi.fn()}
        rootProps={{
          'data-queued-id': 'queue-1',
          'data-testid': 'row-root',
          onDragOver,
          onDragLeave,
          onDrop,
        }}
      />
    );

    const root = screen.getByTestId('row-root');
    expect(root).toHaveAttribute('data-queued-id', 'queue-1');
    expect(root).toHaveAttribute('role', 'button');

    fireEvent.dragOver(root);
    fireEvent.dragLeave(root);
    fireEvent.drop(root);

    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDragLeave).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing structure when no new props are passed', () => {
    renderRow();

    const root = rowElement();
    expect(root.className).toBe(
      'flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer text-left w-full relative'
    );
    expect(root.children).toHaveLength(2);
    expect(root.children[0]?.className).toBe('flex-1 min-w-0');
    expect(root.children[1]?.className).toBe('flex items-center gap-1');
  });
});
