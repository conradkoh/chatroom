# Plan 013: Architecture - Agent Sidebar UX

## Current Design

```
┌──────────────────────────────────────┐
│ AGENTS                               │
├──────────────────────────────────────┤
│ ● builder      WORKING ▸             │  ← Each agent is a row
│ ● reviewer     READY   ▸             │
│ ● tester       NOT JOINED ▸          │
│ ● (more...)                          │
├──────────────────────────────────────┤
│ ✓ Team Ready                         │
└──────────────────────────────────────┘
```

**Issues:**
- All agents take equal space
- Active agents not visually prioritized
- N rows for N agents = tall sidebar

## Proposed Design

```
┌──────────────────────────────────────┐
│ AGENTS                               │
├──────────────────────────────────────┤
│ ● builder      WORKING ▸             │  ← Active agents shown fully
│   └── [view prompt] [copy]           │
├──────────────────────────────────────┤
│ ● Ready (2)    ▸                     │  ← Ready agents collapsed
│   (reviewer, tester)                 │
├──────────────────────────────────────┤
│ ○ Not Joined (1)                     │  ← Disconnected/missing agents
│   (admin)                            │
├──────────────────────────────────────┤
│ ✓ Team Ready                         │
└──────────────────────────────────────┘
```

**Benefits:**
- Active agents get full attention
- Ready agents grouped = less clutter
- Fixed height regardless of team size

## Component Changes

### `AgentPanel.tsx`

**Current Structure:**
```tsx
<div>
  {rolesToShow.map(role => <AgentRow role={role} />)}
  <TeamStatus />
</div>
```

**Proposed Structure:**
```tsx
<div>
  {/* Active/Working agents - always expanded */}
  {activeAgents.map(role => <ActiveAgentRow role={role} />)}
  
  {/* Ready agents - collapsed by default */}
  {readyAgents.length > 0 && (
    <CollapsedAgentGroup 
      title="Ready"
      agents={readyAgents}
      status="success"
    />
  )}
  
  {/* Disconnected/Missing agents - collapsed */}
  {otherAgents.length > 0 && (
    <CollapsedAgentGroup
      title="Disconnected/Not Joined"
      agents={otherAgents}
      status="warning"
    />
  )}
  
  <TeamStatus />
</div>
```

## State Groups

| Status | Display | Collapsible |
|--------|---------|-------------|
| `active` (WORKING) | Full row with prompt | No |
| `waiting` (READY) | Grouped | Yes (collapsed by default) |
| `disconnected` | Grouped | Yes |
| `missing` (NOT JOINED) | Grouped | Yes |

## Interaction Behavior

1. **Active agents**: Always visible, click to expand prompt
2. **Collapsed groups**: Click to expand list
3. **Expanded group**: Shows individual agents, click agent for prompt
4. **Copy button**: Still accessible when expanded
