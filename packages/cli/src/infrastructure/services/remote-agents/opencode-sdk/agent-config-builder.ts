export interface ChatroomAgentDescriptor {
  name: string;
  config: {
    prompt: string;
    mode: 'primary';
    description: string;
  };
}

function sanitizeRole(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

export function buildChatroomAgentDescriptor(input: {
  role: string;
  systemPrompt: string;
}): ChatroomAgentDescriptor {
  const trimmedRole = input.role.trim();
  if (!trimmedRole) {
    throw new Error('role is required to build a chatroom agent');
  }

  const name = `chatroom-${sanitizeRole(trimmedRole)}`;
  const hasSystemPrompt = input.systemPrompt.trim().length > 0;

  return {
    name,
    config: {
      prompt: input.systemPrompt,
      mode: 'primary',
      description: hasSystemPrompt
        ? `Chatroom-injected agent for role: ${input.role}`
        : `Chatroom agent for role ${name} (no system prompt provided)`,
    },
  };
}
