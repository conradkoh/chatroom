import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TimelineMessageRoute,
  TimelineMessageTypeBadge,
  TimelineSenderAgentChip,
} from './TimelineMessageIdentity';

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

describe('TimelineSenderAgentChip', () => {
  const chip = (props: {
    type?: string;
    senderAgent?: { harness: string; model?: string };
    placement?: 'row' | 'dialog';
  }) => (
    <TimelineSenderAgentChip
      type={props.type ?? 'handoff'}
      senderAgent={props.senderAgent}
      placement={props.placement ?? 'row'}
    />
  );

  it('renders harness · model with a muted chip and a descriptive title', () => {
    render(chip({ senderAgent: { harness: 'opencode', model: 'gpt-5.1-codex' } }));

    const element = screen.getByTestId('timeline-sender-agent');
    expect(within(element).getByText('opencode')).toBeInTheDocument();
    expect(within(element).getByText('gpt-5.1-codex')).toBeInTheDocument();
    expect(element).toHaveAttribute('title', 'Harness: opencode · Model: gpt-5.1-codex');
    expect(element).toHaveClass('text-chatroom-text-muted', 'bg-chatroom-bg-tertiary');
    expect(element).toHaveClass('inline-flex', 'text-[10px]', 'px-1.5', 'py-0.5', 'min-w-0');
    expect(element.className).not.toContain('uppercase');
    expect(element.querySelector('svg')).toBeNull();
  });

  it('renders only the harness when there is no model', () => {
    render(chip({ senderAgent: { harness: 'opencode' } }));

    const element = screen.getByTestId('timeline-sender-agent');
    expect(element).toHaveTextContent('opencode');
    expect(element.textContent).toBe('opencode');
    expect(element).toHaveAttribute('title', 'Harness: opencode');
    expect(element.children).toHaveLength(1);
  });

  it('keeps the harness shrink-proof, the model truncatable, and the dot decorative', () => {
    render(chip({ senderAgent: { harness: 'opencode', model: 'gpt-5.1-codex' } }));

    const element = screen.getByTestId('timeline-sender-agent');
    const [harness, dot, model] = Array.from(element.children) as HTMLElement[];
    expect(harness).toHaveTextContent('opencode');
    expect(harness).toHaveClass('shrink-0');
    expect(dot).toHaveTextContent('·');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('shrink-0');
    expect(model).toHaveTextContent('gpt-5.1-codex');
    expect(model).toHaveClass('truncate', 'min-w-0');
  });

  it('caps the row placement width so the route keeps its space', () => {
    render(chip({ senderAgent: { harness: 'opencode' }, placement: 'row' }));

    expect(screen.getByTestId('timeline-sender-agent')).toHaveClass(
      'max-w-[10rem]',
      'sm:max-w-[16rem]'
    );
  });

  it('lets the dialog placement use the full header width', () => {
    render(chip({ senderAgent: { harness: 'opencode' }, placement: 'dialog' }));

    const element = screen.getByTestId('timeline-sender-agent');
    expect(element).toHaveClass('max-w-full');
    expect(element.className).not.toContain('max-w-[10rem]');
  });

  it('clips a long model in both the text and the title', () => {
    render(chip({ senderAgent: { harness: 'opencode', model: 'x'.repeat(70) } }));

    const element = screen.getByTestId('timeline-sender-agent');
    const expected = `${'x'.repeat(64)}…`;
    expect(element).toHaveAttribute('title', `Harness: opencode · Model: ${expected}`);
    expect(within(element).getByText('opencode')).toBeInTheDocument();
    expect(within(element).getByText(expected)).toBeInTheDocument();
  });

  it.each([
    ['handoff', undefined],
    ['handoff', { harness: '   ' }],
    ['notice', { harness: 'opencode', model: 'gpt' }],
    ['message', { harness: 'opencode', model: 'gpt' }],
  ] as const)('renders nothing for %j with snapshot %j', (type, senderAgent) => {
    const { container } = render(chip({ type, senderAgent }));
    expect(container).toBeEmptyDOMElement();
  });
});
