# 024 - Squad Team with Dynamic Workflows

## Summary

This plan redesigns the squad team model to use 3 focused roles (planner, builder, reviewer) with dynamic workflow composition based on team availability. The planner is the central coordinator that handles all user communication and backlog management, delegating implementation and review to available team members — or performing those functions itself when team members are unavailable.

## Goals

1. **Simplified Squad Model** - Replace the 6-role squad (manager, architect, builder, frontend-designer, reviewer, tester) with a focused 3-role team: planner, builder, reviewer
2. **Dynamic Workflows** - Automatically adapt the workflow based on which team members are currently active, with graceful degradation to fewer roles
3. **Planner-Centric Communication** - All user communication flows through the planner; it is the only role that receives user messages and can hand back to the user
4. **Backlog Clearing Mode** - Enable an autonomous mode where the planner continuously processes backlog items without waiting for user input between tasks
5. **Role Fallback** - When a role is unavailable, the remaining roles absorb its responsibilities through prompt guidance

## Non-Goals

1. **Automatic agent spawning** - The system will not automatically start agents to fill missing roles; it adapts to whoever is available
2. **Real-time role detection** - Availability is checked at task-time, not continuously monitored
3. **Breaking pair team** - All existing pair team (builder/reviewer) functionality is preserved unchanged
4. **Concurrent task execution** - Tasks are still processed one at a time; parallelism across roles is not in scope
5. **Custom role composition** - Users cannot define arbitrary roles; the squad team is fixed to planner/builder/reviewer
