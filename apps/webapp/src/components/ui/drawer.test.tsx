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

  it('routes positioning styles to popup and padding styles to content', () => {
    render(<Drawer open><DrawerContent style={{ top: '10px', bottom: 'auto', height: '400px', maxHeight: '400px', paddingLeft: '16px', paddingBottom: '12px' }}><DrawerTitle>Test drawer</DrawerTitle></DrawerContent></Drawer>);
    const popup = document.querySelector('[data-slot="drawer-popup"]') as HTMLElement;
    const content = document.querySelector('[data-slot="drawer-content"]') as HTMLElement;
    expect(popup.style.top).toBe('10px');
    expect(popup.style.bottom).toBe('auto');
    expect(popup.style.height).toBe('400px');
    expect(content.style.paddingLeft).toBe('16px');
    expect(content.style.paddingBottom).toBe('12px');
    expect(content.style.top).toBe('');
  });
});
