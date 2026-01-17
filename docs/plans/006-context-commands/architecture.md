# Plan 006: Features System - Architecture (Simplified)

## Changes Overview

1. Add feature metadata to messages (title, description, techSpecs)
2. Add backend queries for listing/inspecting features
3. Add CLI feature commands (no --role needed)
4. Update task-started to require metadata for new_feature
5. Update wait-for-task to show classification command examples

## Backend Changes

### Schema

```typescript
// services/backend/convex/schema.ts
chatroom_messages: defineTable({
  // ... existing fields ...
  featureTitle: v.optional(v.string()),
  featureDescription: v.optional(v.string()),
  featureTechSpecs: v.optional(v.string()),
})
```

### Mutations

```typescript
// Update taskStarted to accept:
featureTitle: v.optional(v.string()),
featureDescription: v.optional(v.string()),
featureTechSpecs: v.optional(v.string()),
```

### Queries

```typescript
// listFeatures - returns new_feature messages
export const listFeatures = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  // Returns: { id, featureTitle, featureDescription (truncated), createdAt }[]
});

// inspectFeature - returns full feature + thread
export const inspectFeature = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    messageId: v.id('chatroom_messages'),
  },
  // Returns: { feature, thread: Message[] }
});
```

## CLI Changes

### New Commands

```bash
# List features (no --role needed)
chatroom feature list <chatroomId> [--limit=<n>]

# Inspect feature (no --role needed)
chatroom feature inspect <chatroomId> <messageId>
```

### Updated Command

```bash
# task-started for new_feature (requires fields)
chatroom task-started <chatroomId> --role=<role> --classification=new_feature \
  --title="Feature title" \
  --description="What this feature does" \
  --tech-specs="How to implement it"
```

### wait-for-task Output Changes

```json
{
  "instructions": {
    "classificationCommands": {
      "question": "chatroom task-started ... --classification=question",
      "new_feature": "chatroom task-started ... --classification=new_feature --title=\"...\" --description=\"...\" --tech-specs=\"...\"",
      "follow_up": "chatroom task-started ... --classification=follow_up"
    },
    "contextCommands": [
      "chatroom feature list <id> --limit=5"
    ]
  }
}
```

## Data Flow

```
Feature Creation:
1. Agent classifies task as new_feature
2. CLI requires --title, --description, --tech-specs
3. Backend stores metadata with message

Feature Discovery:
1. Agent receives question about past work
2. wait-for-task suggests: chatroom feature list
3. Agent runs list, finds relevant feature
4. Agent runs inspect to get full details
```
