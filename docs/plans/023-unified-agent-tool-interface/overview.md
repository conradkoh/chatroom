# 023 - Unified Agent Tool Interface

## Summary

This plan introduces a unified interface (`AgentToolDriver`) for interacting with AI coding agents (OpenCode, Claude Code, Cursor). Instead of tool-specific spawn logic scattered across `spawn.ts`, each tool gets a driver implementation that conforms to a common contract. Drivers declare their capabilities via a discovery mechanism, enabling the daemon and UI to adapt behavior based on what each tool supports.

## Goals

1. **Common Interface** - Define an `AgentToolDriver` interface that all agent tools implement. This replaces the current switch-statement approach in `spawn.ts` with polymorphic dispatch.
2. **Capability Discovery** - Each driver declares what it supports (session persistence, abort, model selection, compaction, event streaming, etc.). The daemon and UI query capabilities at runtime.
3. **Session Management** - Drivers that support sessions (e.g., OpenCode via SDK) can create, resume, and abort sessions. Drivers that don't (e.g., Cursor) fall back to process-based lifecycle.
4. **Incremental Adoption** - The current spawn-based approach becomes the `ProcessAgentDriver` base class. OpenCode's SDK-based driver extends or replaces it without breaking Claude/Cursor.
5. **Daemon State Recovery** - For SDK-based drivers, session IDs are persisted so the daemon can recover state after restart without losing running agents.

## Non-Goals

1. **Full SDK integration for all tools** - Only OpenCode has an SDK; Claude and Cursor remain process-based.
2. **Real-time event streaming to UI** - Event subscription is a capability but piping events to the chatroom UI is deferred.
3. **Daemon auto-restart/watchdog** - Daemon reliability is separate from the driver interface.
4. **Multi-version driver support** - Each tool gets one active driver (not multiple versions simultaneously).
