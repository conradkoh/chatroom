import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';

describe('RadioGroup', () => {
  it('selects a radio option', async () => {
    const user = userEvent.setup();
    render(
      <RadioGroup defaultValue="a">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="a" id="a" />
          <Label htmlFor="a">Option A</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="b" id="b" />
          <Label htmlFor="b">Option B</Label>
        </div>
      </RadioGroup>
    );
    const optionB = screen.getByRole('radio', { name: 'Option B' });
    await user.click(optionB);
    expect(optionB).toBeChecked();
  });
});
