/**
 * CHATROOM STATE section - shows current chatroom and participant info.
 */

import type { PromptSection, TaskDeliveryContext } from '../types';

export const chatroomStateSection: PromptSection = {
  id: 'chatroom-state',
  title: 'CHATROOM STATE',
  icon: '📋',

  shouldRender: () => true,

  render: (ctx: TaskDeliveryContext): string => {
    const lines: string[] = [`Chatroom ID: ${ctx.chatroomId}`];

    if (ctx.teamRoles && ctx.teamRoles.length > 0) {
      lines.push(`Team: ${ctx.teamName || 'Unknown'} (${ctx.teamRoles.join(', ')})`);
    }

    lines.push('\nParticipants:');

    for (const p of ctx.participants) {
      const isYou = p.role.toLowerCase() === ctx.role.toLowerCase();
      const youMarker = isYou ? ' (you)' : '';
      const statusIcon = p.status === 'active' ? '🔵' : p.status === 'waiting' ? '🟢' : '⚪';
      const availableMarker = p.status === 'waiting' && !isYou ? ' ✓ available' : '';
      lines.push(`  ${statusIcon} ${p.role}${youMarker} - ${p.status}${availableMarker}`);
    }

    return lines.join('\n');
  },
};
