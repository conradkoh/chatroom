# Plan 006: Features System & Context Commands

## Summary

Introduce a "Features" system as a core entity, allowing agents to discover and inspect past features. When a task is classified as `new_feature`, the agent must provide a title, description, and technical specifications. The `wait-for-task` output will include command examples for each classification type.

## Goals

1. **Reduce agent confusion** - Agents can list/inspect features for context
2. **Structured new_feature metadata** - Title, description, and tech specs are captured
3. **Better prompts** - Wait-for-task includes classification-specific command examples
4. **Build foundation** - Features become a core entity to build upon

## Non-Goals

- Creating a full feature management UI
- Changing existing message types or handoff workflow
- Breaking backward compatibility (backend accepts optional fields)
