import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InlineEditableTitle } from './InlineEditableTitle';

describe('InlineEditableTitle', () => {
  it('shows pencil button and enters edit mode on click', () => {
    const onStartEdit = vi.fn();

    render(
      <InlineEditableTitle
        value="My title"
        editedValue=""
        onEditedValueChange={vi.fn()}
        isEditing={false}
        onStartEdit={onStartEdit}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        editButtonTitle="Rename"
        inputAriaLabel="Title"
      />
    );

    expect(screen.getByText('My title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onStartEdit).toHaveBeenCalled();
  });

  it('renders save and cancel controls while editing', () => {
    render(
      <InlineEditableTitle
        value="My title"
        editedValue="Edited"
        onEditedValueChange={vi.fn()}
        isEditing
        onStartEdit={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        editButtonTitle="Rename"
        saveButtonTitle="Save title"
        inputAriaLabel="Title"
      />
    );

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Edited');
    expect(screen.getByTitle('Save title')).toBeInTheDocument();
    expect(screen.getByTitle('Cancel')).toBeInTheDocument();
  });
});
