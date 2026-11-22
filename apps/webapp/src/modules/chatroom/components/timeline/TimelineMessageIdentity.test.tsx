import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TimelineMessageRoute, TimelineMessageTypeBadge } from './TimelineMessageIdentity';

describe('TimelineMessageTypeBadge', () => {
  it('renders the handoff badge with purple tokens and a leading icon', () => {
    render(<TimelineMessageTypeBadge type="handoff" />);
    const badge = screen.getByText('handoff');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('bg-chatroom-status-purple/15', 'text-chatroom-status-purple');
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('renders the notice badge with info tokens and a decorative icon', () => {
    render(<TimelineMessageTypeBadge type="notice" />);
    const badge = screen.getByText('notice');
    expect(badge).toHaveClass('bg-chatroom-status-info/15', 'text-chatroom-status-info');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['message', 'user', ''])('renders nothing for type %j', (type) => {
    const { container } = render(<TimelineMessageTypeBadge type={type} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TimelineMessageRoute', () => {
  it('renders only the sender when there is no target and no Telegram tag', () => {
    const { container } = render(<TimelineMessageRoute senderRole="planner" />);
    expect(screen.getByText('planner')).toHaveClass('text-chatroom-status-info');
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
  });

  it('renders sender, arrow, and target when a target is given', () => {
    const { container } = render(
      <TimelineMessageRoute senderRole="planner" targetRole="builder" />
    );
    expect(screen.getByText('planner')).toBeInTheDocument();
    expect(screen.getByText('builder')).toHaveClass('text-chatroom-status-info');
    expect(container.querySelector('svg')).toHaveClass('flex-shrink-0');
  });

  it('styles a user sender with the amber user classes', () => {
    render(<TimelineMessageRoute senderRole="user" />);
    expect(screen.getByText('user')).toHaveClass('text-amber-500');
  });

  it('renders the Telegram tag before the target when sourcePlatform is telegram', () => {
    render(
      <TimelineMessageRoute senderRole="user" targetRole="planner" sourcePlatform="telegram" />
    );
    const tag = screen.getByText('Telegram');
    expect(tag).toHaveClass('bg-chatroom-bg-tertiary', 'text-[9px]');
    expect(
      screen.getByText('user').compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      tag.compareDocumentPosition(screen.getByText('planner')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('does not render the Telegram tag for other platforms', () => {
    render(<TimelineMessageRoute senderRole="planner" sourcePlatform="web" />);
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
  });

  it('keeps the arrow and the target role in one unbreakable group', () => {
    render(<TimelineMessageRoute senderRole="planner" targetRole="builder" />);

    const target = screen.getByText('builder');
    const group = target.parentElement as HTMLElement;
    expect(group).toHaveClass('inline-flex', 'whitespace-nowrap');
    expect(group.querySelector('svg')).not.toBeNull();
    expect(group).not.toContainElement(screen.getByText('planner'));
  });

  it('keeps the sender and the Telegram tag outside the arrow group', () => {
    render(
      <TimelineMessageRoute senderRole="user" targetRole="planner" sourcePlatform="telegram" />
    );

    const group = screen.getByText('planner').parentElement as HTMLElement;
    expect(group).toHaveClass('inline-flex', 'whitespace-nowrap');
    expect(group.querySelector('svg')).not.toBeNull();
    expect(group).not.toContainElement(screen.getByText('user'));
    expect(group).not.toContainElement(screen.getByText('Telegram'));
  });
});
