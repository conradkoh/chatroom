# 022 - Machine Identity Registration

## Summary

This plan adds machine identity registration and remote agent management capabilities to the chatroom CLI. It enables users to remotely start AI agents (OpenCode, Claude Code, Cursor) on their registered machines through the web UI, providing a seamless way to restart disconnected agents without manual terminal intervention.

## Goals

1. **Machine Identity** - Automatically register machines when agents run `wait-for-task`, creating a persistent machine identity stored locally and synced to the backend
2. **Agent Tool Detection** - Detect which AI coding tools (opencode, claude, cursor) are installed on each machine and report availability to the backend
3. **Remote Agent Control** - Enable users to start agents remotely via the web UI by sending commands through a daemon process running on the target machine
4. **Security** - Ensure only authenticated users can send commands to their own machines, with server-side command generation to prevent injection attacks

## Non-Goals

1. **Auto-start daemon on boot** - The daemon will be manually started by the user; auto-start configuration is out of scope
2. **Agent process monitoring** - The daemon spawns agents but does not monitor their lifecycle after spawn
3. **Multi-user machine sharing** - Machines are owned by a single user; sharing machines across users is not supported
4. **Agent session resumption** - Spawned agents start fresh sessions; resuming previous agent sessions is not in scope
5. **Web UI implementation** - This plan covers backend infrastructure and CLI; web UI buttons are planned but implementation is deferred
