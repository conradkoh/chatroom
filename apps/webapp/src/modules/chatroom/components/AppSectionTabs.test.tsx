import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSectionTabs } from './AppSectionTabs';

const mocks = vi.hoisted(() => ({ pathname: '/app' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('AppSectionTabs', () => {
  beforeEach(() => {
    mocks.pathname = '/app';
  });

  it('marks Chatrooms as the current page on /app', () => {
    render(<AppSectionTabs />);

    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeDefined();

    const chatrooms = screen.getByTestId('app-section-tab-chatrooms');
    const machines = screen.getByTestId('app-section-tab-machines');

    expect(chatrooms.getAttribute('href')).toBe('/app');
    expect(chatrooms.getAttribute('aria-current')).toBe('page');
    expect(machines.getAttribute('href')).toBe('/app/machines');
    expect(machines.getAttribute('aria-current')).toBeNull();
  });

  it('marks Machines as the current page on /app/machines', () => {
    mocks.pathname = '/app/machines';
    render(<AppSectionTabs />);

    const chatrooms = screen.getByTestId('app-section-tab-chatrooms');
    const machines = screen.getByTestId('app-section-tab-machines');

    expect(machines.getAttribute('aria-current')).toBe('page');
    expect(chatrooms.getAttribute('aria-current')).toBeNull();
  });

  it('keeps Machines current on nested machines paths', () => {
    mocks.pathname = '/app/machines/machine-a';
    render(<AppSectionTabs />);

    expect(screen.getByTestId('app-section-tab-machines').getAttribute('aria-current')).toBe(
      'page'
    );
    expect(screen.getByTestId('app-section-tab-chatrooms').getAttribute('aria-current')).toBeNull();
  });
});
