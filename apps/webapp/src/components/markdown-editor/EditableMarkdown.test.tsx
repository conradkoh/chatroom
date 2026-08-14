import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EditableMarkdown } from './EditableMarkdown';

// MDXEditor is loaded via next/dynamic (ssr: false) and depends on browser
// APIs unavailable in jsdom, so the real editor stays on its "Loading editor"
// placeholder in unit tests. Substitute a lightweight controlled editor that
// mirrors MarkdownEditor's public contract (defaultMarkdown + onChange).
vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({
    defaultMarkdown = '',
    onChange,
    placeholder,
  }: {
    defaultMarkdown?: string;
    onChange?: (markdown: string) => void;
    placeholder?: string;
  }) => (
    <div data-testid="markdown-editor">
      <textarea
        aria-label="editable markdown"
        placeholder={placeholder}
        defaultValue={defaultMarkdown}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </div>
  ),
}));

const sampleMarkdown = `# Heading One

Visit [example link](https://example.com) for more.`;

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <EditableMarkdown markdown={value} onChange={setValue} />;
}

describe('EditableMarkdown', () => {
  it('renders markdown in view mode via MarkdownViewer', () => {
    render(<EditableMarkdown markdown={sampleMarkdown} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Heading One' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'example link' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('clicking view area enters edit mode showing Save and Cancel', async () => {
    const user = userEvent.setup();
    render(<EditableMarkdown markdown={sampleMarkdown} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit markdown' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Save calls onChange with edited content and returns to view mode', async () => {
    const user = userEvent.setup();
    render(<Harness initial={sampleMarkdown} />);

    await user.click(screen.getByRole('button', { name: 'Edit markdown' }));

    const editable = screen.getByLabelText('editable markdown', { exact: true });
    await user.clear(editable);
    await user.type(editable, 'Edited content');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Edited content')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Heading One' })
    ).not.toBeInTheDocument();
  });

  it('Cancel discards edits and returns to view mode without calling onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditableMarkdown markdown={sampleMarkdown} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Edit markdown' }));

    const editable = screen.getByLabelText('editable markdown', { exact: true });
    await user.clear(editable);
    await user.type(editable, 'discarded edit');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Heading One' })).toBeInTheDocument();
    expect(screen.queryByText('discarded edit')).not.toBeInTheDocument();
  });

  it('empty markdown shows muted placeholder', () => {
    render(<EditableMarkdown markdown="   " onChange={vi.fn()} placeholder="Click to add..." />);

    expect(screen.getByText('Click to add...')).toBeInTheDocument();
  });

  it('clicking a link in view mode does not enter edit mode', () => {
    render(<EditableMarkdown markdown={sampleMarkdown} onChange={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'example link' });
    fireEvent.click(link);

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('Enter key on the view container enters edit mode', async () => {
    const user = userEvent.setup();
    render(<EditableMarkdown markdown={sampleMarkdown} onChange={vi.fn()} />);

    const view = screen.getByRole('button', { name: 'Edit markdown' });
    view.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
