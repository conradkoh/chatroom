# Harness turn fixtures

These JSONL files are small, stable protocol samples used by the completion-boundary
tests. They intentionally preserve the provider's terminal signal instead of reducing
every harness to `agent_end`.

The OpenCode sample models the event shape observed by the `opencode/big-pickle`
native-flow integration: reasoning/text parts, a tool lifecycle, and a session idle
event after the turn. The local environment did not expose `opencode/big-pickle` through
`opencode models` while these fixtures were added, so this is a checked-in behavioral
sample rather than a captured live transcript. The integration test remains the live
validation path when the model is available.
