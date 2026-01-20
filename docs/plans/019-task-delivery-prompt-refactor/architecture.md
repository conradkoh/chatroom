# Architecture: Task Delivery Prompt Refactor

## Changes Overview

Moving prompt construction from CLI (`packages/cli/src/commands/wait-for-task.ts`) to backend (`services/backend/convex/prompts/`), introducing a composable section-based architecture.

## New Components

### Backend: `services/backend/convex/prompts/taskDelivery/`

New directory containing the task delivery prompt generation system.

```
services/backend/convex/prompts/taskDelivery/
├── index.ts              # Main getTaskDeliveryPrompt export
├── types.ts              # TaskDeliveryContext, PromptSection interfaces
├── sections/
│   ├── index.ts          # Section registry
│   ├── messageReceived.ts
│   ├── chatroomState.ts
│   ├── nextSteps.ts
│   ├── roleGuidance.ts
│   ├── backlogCommands.ts
│   └── jsonOutput.ts
└── formatters.ts         # Section formatting utilities
```

### Backend: New Query `getTaskDeliveryPrompt`

Add to `services/backend/convex/messages.ts` - returns the complete task delivery prompt.

## Modified Components

### CLI: `packages/cli/src/commands/wait-for-task.ts`

Simplify to:
1. Poll for tasks (unchanged)
2. Claim task (unchanged)
3. Call `getTaskDeliveryPrompt` query
4. Print returned human-readable content
5. Print returned JSON output

## New Contracts

### TaskDeliveryContext

```typescript
interface TaskDeliveryContext {
  chatroomId: string;
  role: string;
  task: {
    _id: string;
    content: string;
    status: string;
    createdBy: string;
    queuePosition: number;
  };
  message: {
    _id: string;
    content: string;
    senderRole: string;
    type: string;
    targetRole?: string;
  } | null;
  participants: Array<{
    role: string;
    status: string;
  }>;
  contextWindow: {
    originMessage: ContextMessage | null;
    contextMessages: ContextMessage[];
    classification: string | null;
  };
  rolePrompt: {
    prompt: string;
    currentClassification: string | null;
    availableHandoffRoles: string[];
    restrictionReason: string | null;
  };
  teamName: string;
  teamRoles: string[];
}

interface ContextMessage {
  _id: string;
  senderRole: string;
  content: string;
  type: string;
  targetRole?: string;
  classification?: string;
  attachedTaskIds?: string[];
}
```

### PromptSection

```typescript
interface PromptSection {
  id: string;
  title: string;
  icon: string;
  /**
   * Determines if this section should be rendered for the given context
   */
  shouldRender(ctx: TaskDeliveryContext): boolean;
  /**
   * Renders the section content
   */
  render(ctx: TaskDeliveryContext): string;
}
```

### TaskDeliveryPromptResponse

```typescript
interface TaskDeliveryPromptResponse {
  /**
   * Human-readable prompt sections, pre-formatted for display
   */
  humanReadable: string;
  /**
   * Structured JSON data for programmatic parsing
   */
  json: {
    message: {
      id: string;
      senderRole: string;
      content: string;
      type: string;
    };
    task: {
      id: string;
      status: string;
      createdBy: string;
      queuePosition: number;
    };
    chatroom: {
      id: string;
      participants: Array<{
        role: string;
        status: string;
        isYou: boolean;
        availableForHandoff: boolean;
      }>;
    };
    context: {
      originMessage: object | null;
      allMessages: object[];
      currentClassification: string | null;
    };
    instructions: {
      taskStartedCommand: string | null;
      taskCompleteCommand: string;
      availableHandoffRoles: string[];
      terminationRole: string;
      classification: string | null;
      handoffRestriction: string | null;
      classificationCommands: Record<string, string>;
      contextCommands: string[] | undefined;
    };
  };
}
```

## Data Flow Changes

### Before (Current)

```
CLI polls → Task found → CLI claims task →
CLI fetches: chatroom, participants, rolePrompt, contextWindow →
CLI constructs human-readable sections locally →
CLI constructs JSON output locally →
CLI prints everything
```

### After (New)

```
CLI polls → Task found → CLI claims task →
CLI calls getTaskDeliveryPrompt(chatroomId, role, taskId) →
Backend fetches all data and constructs sections →
Backend returns { humanReadable, json } →
CLI prints humanReadable →
CLI prints JSON.stringify(json)
```

## Integration Changes

### New Backend Query

```typescript
// services/backend/convex/messages.ts
export const getTaskDeliveryPrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id("chatroom_rooms"),
    role: v.string(),
    taskId: v.id("chatroom_tasks"),
    messageId: v.optional(v.id("chatroom_messages")),
  },
  handler: async (ctx, args): Promise<TaskDeliveryPromptResponse> => {
    // Fetch all needed data
    // Build TaskDeliveryContext
    // Call buildTaskDeliveryPrompt(context)
    // Return result
  },
});
```

### CLI Changes

The CLI will be simplified from ~200 lines of prompt construction to ~20 lines:

```typescript
// After claiming task, instead of constructing everything locally:
const promptResponse = await client.query(api.messages.getTaskDeliveryPrompt, {
  sessionId,
  chatroomId,
  role,
  taskId: task._id,
  messageId: message?._id,
});

console.log(promptResponse.humanReadable);
console.log('\n' + '─'.repeat(50));
console.log('📊 MESSAGE DATA (JSON)');
console.log('─'.repeat(50));
console.log(JSON.stringify(promptResponse.json, null, 2));
```
