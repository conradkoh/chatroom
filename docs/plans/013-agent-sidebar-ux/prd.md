# Plan 013: PRD - Agent Sidebar UX Improvements

## Problem Statement

The current AGENTS section in the chatroom sidebar has UX issues:

1. **Fixed height too large** - Takes up significant vertical space regardless of agent activity
2. **No visual hierarchy** - Active (working) agents look the same as idle ones
3. **Clutter** - When team is ready, all agents show individually when only the active one matters

## User Stories

### As a user watching agent activity:
> I want to immediately see which agent is currently working so I can understand what's happening

### As a user with limited screen space:
> I want the agent section to be compact so I have more room for the message feed

### As a user copying prompts:
> I want quick access to agent prompts without hunting through a long list

## Requirements

### Functional

1. **Active agents shown prominently**
   - Active (WORKING) agents displayed at the top
   - Always expanded with prompt visible
   - Visual emphasis (highlight, animation)

2. **Ready agents grouped**
   - All ready agents collapsed into one row: "Ready (N)"
   - Click to expand and see individual agents
   - Collapsed by default

3. **Other agents grouped**
   - Disconnected/missing agents grouped separately
   - Warning indicator
   - Expandable for details

### Non-Functional

1. **Responsive** - Works on mobile and desktop
2. **Dark mode** - Proper colors in both themes
3. **Accessible** - Keyboard navigation, ARIA labels
4. **Performance** - No jank on expand/collapse

## UI Mockup

### Default State (1 active, 2 ready)

```
┌────────────────────────────────────┐
│ AGENTS                             │
├────────────────────────────────────┤
│ 🔵 builder        WORKING          │
│    [view prompt] [copy]            │
├────────────────────────────────────┤
│ ● Ready (2)                     ▸  │
├────────────────────────────────────┤
│ ✓ Team Ready                       │
└────────────────────────────────────┘
```

### Expanded Ready Group

```
┌────────────────────────────────────┐
│ AGENTS                             │
├────────────────────────────────────┤
│ 🔵 builder        WORKING          │
│    [view prompt] [copy]            │
├────────────────────────────────────┤
│ ● Ready (2)                     ▾  │
│   ├─ reviewer     READY      ▸     │
│   └─ tester       READY      ▸     │
├────────────────────────────────────┤
│ ✓ Team Ready                       │
└────────────────────────────────────┘
```

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Sidebar height (3 agents) | ~200px | ~100px |
| Clicks to copy active prompt | 2 | 1 |
| Visual hierarchy | None | Clear |

## Risks

| Risk | Mitigation |
|------|------------|
| Confusing collapsed groups | Clear labels, count shown |
| Hidden prompt access | Active agent always shows prompt |
| Breaking mobile | Test responsive design |
