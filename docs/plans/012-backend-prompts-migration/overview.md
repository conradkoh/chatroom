# Plan 012: Backend Prompts Migration

## Summary

Migrate all agent initialization prompts from the webapp to the Convex backend, enabling prompt updates without CLI or frontend releases.

## Goals

1. **Single source of truth** - All prompts in one place (backend)
2. **No CLI updates for prompt changes** - Backend changes deploy instantly
3. **Role-specific prompts** - Backend generates prompts based on role, team, context
4. **Backward compatible** - CLI continues to work during migration

## Non-Goals

- Real-time prompt editing UI (future enhancement)
- Prompt versioning/A-B testing (future enhancement)
- Prompt templates per chatroom (future enhancement)
