/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 */

import { getCliEnvPrefix } from '../../../utils/index.js';

export interface ContextGainingOptions {
  chatroomId: string;
  role: string;
  convexUrl?: string;
}

/**
 * Get context-gaining guidance for agents joining a conversation.
 * Provides instructions for understanding both user perspective and code changes.
 */
export function getContextGainingGuidance(options: ContextGainingOptions): string {
  const { chatroomId, role, convexUrl } = options;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  return `## Gaining Context

You are joining a conversation and you may not have full context. The goal of context-gaining is to understand the request from the user, so that they feel there is continuity in the conversation.

### User Perspective

The user's perspective is important because it is the ground truth to the question "What is the objective?". The user's foremost concern is what has been communicated via the chat.

**Get recent user messages:**

\`\`\`bash
${cliEnvPrefix}chatroom messages list ${chatroomId} --role=${role} --sender-role=user --limit=5 --full
\`\`\`

This shows the last 5 user messages with full content, including:
- Original requests and feature descriptions
- Follow-up questions and clarifications
- Feedback on delivered work

**Get conversation flow since a specific message:**

\`\`\`bash
${cliEnvPrefix}chatroom messages list ${chatroomId} --role=${role} --since-message-id=<message-id> --full
\`\`\`

This shows all messages since a specific point, useful for understanding:
- The complete conversation thread
- Task handoffs between agents
- Classification (question, new_feature, follow_up)

### Code Perspective

The code is a source of truth for what currently exists and has been implemented. Recent commits give context about:
- What features have been added
- Current code conventions and patterns
- Recent bug fixes or refactoring

**View recent commits:**

\`\`\`bash
git log --oneline -10
\`\`\`

**View detailed recent changes:**

\`\`\`bash
git log -5 --stat --pretty=format:"%h - %an, %ar : %s"
\`\`\`

**See what's currently in progress:**

\`\`\`bash
git status && git diff
\`\`\`

### When to Gain Context

Gain context proactively in these situations:
- **First time joining** - Always review recent messages and commits
- **After long idle** - Check what happened since you were last active
- **Unclear task** - Review conversation history before asking clarifying questions
- **Continuing work** - Understand what was done before and why

### Best Practices

1. **Start with user messages** - Understand what the user wants first
2. **Review commit history** - See what's already been implemented
3. **Check current state** - Look at working directory and staged changes
4. **Ask for clarification** - If still unclear after reviewing context
5. **Acknowledge context** - Show the user you understand the broader picture`;
}
