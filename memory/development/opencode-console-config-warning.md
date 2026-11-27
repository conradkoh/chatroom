---
type: guide
title: OpenCode Console config-probe warning
description: Why OpenCode logs a benign WARN for a failed Console provider config probe (401 from opencode.ai/console/api/v2/config), the user-side remedy, and how chatroom filters that one line.
tags: [opencode, harness, logs, troubleshooting]
status: stable
---

# OpenCode Console config-probe warning

## Symptom

The chatroom harness log stream shows a recurring WARN from `opencode serve`:

    failed to load OpenCode provider config
    cause=HttpClientError: StatusCode: non 2xx status code (401 GET https://opencode.ai/console/api/v2/config)

## Source

The warning comes from OpenCode's built-in Console provider plugin, not from this repository. The plugin refreshes its provider config from `https://opencode.ai/console/api/v2/config` in a background timer every 60 seconds. A 401 with an Unauthorized body is treated as signed out. Any other non-2xx response logs the same WARN.

## Impact

- Non-fatal. OpenCode falls back to the cached or empty provider config.
- No measured runtime slowdown. The refresh is a background timer under a one-permit semaphore, and a 401 returns quickly. Earlier suspicion that it slows agent tasks is not supported by the evidence.
- Volume: one line per minute per running `opencode serve` process. The local OpenCode log at `~/.local/share/opencode/log/opencode.log` held 62,940 occurrences when diagnosed.

## User-side remedy

Sign out of OpenCode Console, or remove the stale OpenCode Console connection, in OpenCode. This clears the 401 at its source. Chatroom does not verify the remote endpoint.

## Chatroom filter

`wireChildOutput` in `packages/cli/src/daemon/infrastructure/local/harness/services/opencode-sdk/opencode-sdk-agent-service.ts` does not forward a stderr line for which `isOpencodeConsoleConfigProbeWarning` (in `pure.ts`) is true. That predicate requires both `failed to load OpenCode provider config` and `opencode.ai/console/api/v2/config`.

Every other stderr line still forwards, including other provider warnings such as `failed to load model`. INFO filtering, stderr activity emission, and stdout handling are unchanged.

The filter hides the log noise only. It does not change the OpenCode binary, its SDK version, or the plugin's retry behaviour.
