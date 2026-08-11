import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from './drawer';

describe('Drawer', () => {
  it('renders content when open', () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Test drawer</DrawerTitle>
          <DrawerDescription>Test description</DrawerDescription>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByText('Test drawer')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });
});
