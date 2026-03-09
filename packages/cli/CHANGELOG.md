# Changelog

## [1.5.0] — 2026-03-09

### Added

- **Cursor Agent Harness**: Full support for Cursor IDE as an agent harness (`CursorAgentService`, `CursorStreamReader`). Agents can now be spawned and managed via Cursor alongside opencode and pi.
- **Harness Registry**: Centralized registry pattern (`initHarnessRegistry`, `registerHarness`, `getHarness`, `getAllHarnesses`) replaces scattered harness maps and unions across the CLI. Adding a new harness now requires a single registration call.
- **Cursor Models**: Hardcoded Cursor models (`opus-4.6`, `sonnet-4.6`) since Cursor doesn't expose a model list API.
- **Foreground Warning**: `get-next-task` output now warns if the command is moved to background, with guidance to terminate and restart.

### Changed

- **StopReason Conventions**: Renamed stop reasons from underscore-case to actor-prefixed format for better tracing:
  - `intentional_stop` → `user.stop`
  - `daemon_respawn_stop` → `daemon.respawn`
  - `process_exited_with_success` → `agent_process.exited_clean`
  - `process_terminated_with_signal` → `agent_process.signal`
  - `process_terminated_unexpectedly` → `agent_process.crashed`
- **Decoupled Machine Registration**: `auth-status` and `register-agent` no longer perform machine registration inline — cleaner separation of concerns.
- **AgentHarness Type**: Consolidated into backend domain entities (`@workspace/backend/src/domain/entities/agent`), eliminating duplicate type definitions across CLI and webapp.
- **Model Select Popover**: Reverted to ShadCN default popover behavior with `modal={false}` at call site — fixes performance lag when opening model selection.

### Fixed

- Circuit breaker no longer falsely counts `user.stop` and `daemon.respawn` exits toward the trip threshold.
- Cursor added to version detection commands and model discovery in `register-agent`, `get-next-task`, and `auth-status`.
- Frontend `AgentHarness` type and display names updated to include Cursor.

### Removed

- Dead exports: `isHarnessAvailable`, `getHarnessIds`, `getInstalledHarnesses`, `getModelShortName`
- Deprecated `PingCommand` and `StatusCommand` interfaces
- Deprecated `WaitForTaskSession` and `WaitForTaskResponse` re-exports
- No-op `removeIdleParticipants` migration
- Stale test mocks referencing modules no longer imported by source
