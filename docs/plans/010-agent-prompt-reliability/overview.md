# Plan 010: Agent Prompt Reliability and Reviewer Bug Fixes

## Summary

Address three related backlog items focused on agent prompt reliability and reviewer role behavior:

1. **Agent Prompts Reliability** - Ensure consistent and predictable agent behavior through robust prompts
2. **Reviewer Role Regression** - Fix behavioral issues with the reviewer agent
3. **Reviewer Retrieves Incorrect Messages** - Fix message context/routing bugs affecting the reviewer

## Goals

1. **Reliable Prompts**: Agents follow instructions consistently, especially for `wait-for-task` lifecycle
2. **Correct Message Routing**: Reviewer receives the correct messages and context
3. **Clear Role Boundaries**: Each role has clear, unambiguous instructions

## Non-Goals

- Adding new CLI commands
- Changing the team composition or workflow
- Performance optimization (covered by Plan 009)
- UI changes

## Impact Assessment

| Area | Impact |
|------|--------|
| Backend Prompts | Medium - Generator improvements |
| Frontend Prompts | Medium - Init prompt refinements |
| Message Routing | Low - Targeted fixes |
| CLI | None |

## Related Backlog Items

- #20: `md7e752mtfed6x6qswz0tyr14n7zh2sf` - Prompts Reliability
- #2: `md7f1zk6ywww0hx39s81fjhngn7zb714` - Reviewer Regression
- #15: `md72wk5c2nmpynqq2hzf711ce57zgfgy` - Incorrect Messages
