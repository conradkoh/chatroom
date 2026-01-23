# Prompts System

A clean, maintainable structure for agent prompts with team-based customization support.

## Structure

```
prompts/
├── base/                   # Base prompts (shared by all teams)
│   ├── cli/                # CLI-specific prompts
│   │   ├── task-started/
│   │   ├── handoff/
│   │   └── wait-for-task/
│   ├── roles/              # Agent role definitions
│   │   ├── builder.ts       # Builder role guidance
│   │   ├── reviewer.ts      # Reviewer role guidance
│   │   └── index.ts
│   ├── workflows/          # Workflow definitions
│   │   ├── pair.ts          # Pair team workflow
│   │   └── index.ts
│   └── shared/             # Shared utilities
│       ├── config.ts
│       ├── types.ts
│       └── formatters.ts
├── teams/                  # Team-specific customizations
│   ├── pair/               # Pair team (builder + reviewer)
│   │   ├── config.ts        # Team configuration
│   │   ├── workflow.ts      # Pair workflow logic
│   │   └── prompts/
│   │       ├── builder.ts   # Builder-specific overrides
│   │       ├── reviewer.ts  # Reviewer-specific overrides
│   │       └── index.ts
│   └── index.ts
├── generator.ts            # Team-aware prompt generator
├── index.ts               # Main exports
└── README.md
```

## Key Concepts

### **Base Prompts**

- Shared prompts used by all teams
- Common role definitions (builder, reviewer)
- CLI command prompts
- Shared utilities and types

### **Team Customization**

- Teams can override base prompts
- Team-specific workflow logic
- Role-specific guidance for team context

### **Pair Team**

- Default team configuration
- Builder + Reviewer roles
- Established handoff workflow

## Usage

### **Base Prompts**

```typescript
import { getBaseBuilderGuidance } from "./base/roles/builder.js";
```

### **Team-Specific Prompts**

```typescript
import { getBuilderGuidance } from "./teams/pair/prompts/builder.js";
```

### **Generator Logic**

```typescript
// Automatically detects team and applies appropriate prompts
export function getRolePrompt(
  chatroomId: string,
  role: string,
  ctx: RolePromptContext,
) {
  const teamName = "pair"; // Currently only pair team
  const teamPrompt = getTeamRolePrompt(teamName, role, ctx);
  return teamPrompt || getBaseRolePrompt(role, ctx);
}
```

## Team Configuration

### **Pair Team**

```typescript
export const pairTeamConfig = {
  name: "pair",
  roles: ["builder", "reviewer"],
  entryPoint: "builder",
  workflow: "pair",
};
```

### **Workflow Rules**

- Builder → Reviewer (for code changes)
- Reviewer → User (for approval)
- Builder → User (for simple questions)

## Migration Notes

This structure replaces the legacy `init/` and `phases/` directories with a cleaner, more maintainable organization.
