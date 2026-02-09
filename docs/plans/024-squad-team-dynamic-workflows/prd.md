# 024 - Squad Team with Dynamic Workflows: PRD

## Glossary

| Term | Definition |
| --- | --- |
| **Planner** | The entry-point role that handles all user communication, task decomposition, backlog management, and team coordination |
| **Builder** | The implementation role responsible for writing code and building solutions |
| **Reviewer** | The quality role responsible for reviewing code and validating changes |
| **Dynamic Workflow** | A workflow that adapts its routing based on which team members are currently active |
| **Role Fallback** | When a role is unavailable, another role absorbs its responsibilities |
| **Backlog Clearing Mode** | An autonomous mode where the planner processes backlog items continuously |
| **Team Availability** | The set of roles that currently have active participants in the chatroom |

## User Stories

### Team Setup

**US-1**: As a user, I want to create a squad chatroom with planner/builder/reviewer roles, so that I have a focused team for complex tasks.

**US-2**: As a user, I want to start with just the planner active, so that I can begin working immediately without waiting for all roles to be filled.

**US-3**: As a user, I want to add builder and reviewer agents later, so that the team can grow organically.

### Dynamic Workflows

**US-4**: As a planner, I want to know which team members are available when I receive a task, so that I can route work appropriately.

**US-5**: As a planner with only myself available, I want to handle implementation and review myself, so that work doesn't stall waiting for unavailable roles.

**US-6**: As a planner with a builder but no reviewer, I want to delegate implementation to the builder and review the work myself, so that quality is still checked.

**US-7**: As a planner with a builder and reviewer, I want to delegate implementation to builder and review to reviewer, so that each role focuses on their specialty.

### Planner Role

**US-8**: As a planner, I want to be the only role that communicates with the user, so that the user has a single point of contact.

**US-9**: As a planner, I want exclusive access to the backlog, so that task prioritization is centralized.

**US-10**: As a planner, I want to decompose complex tasks before delegating, so that builders receive clear, actionable work.

### Role Fallback

**US-14**: As a builder, when the reviewer is unavailable, I want to hand off directly to the planner for review, so that the workflow continues.

**US-15**: As a reviewer, when the builder is unavailable, I want to receive implementation tasks from the planner, so that work can still be done.

## Workflow Variants

### Full Team (Planner + Builder + Reviewer)

```
User → Planner → Builder → Reviewer → Planner → User
```

### Planner + Builder Only

```
User → Planner → Builder → Planner(reviews) → User
```

### Planner + Reviewer Only

```
User → Planner → Reviewer(implements) → Planner → User
```

### Planner Solo

```
User → Planner(implements + reviews) → User
```
