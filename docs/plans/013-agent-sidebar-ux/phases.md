# Plan 013: Implementation Phases

## Phase 1: Refactor Agent Status Groups

**Goal:** Separate agents into status-based groups

**Changes:**
- Add `useMemo` to categorize agents:
  - `activeAgents` - status === 'active'
  - `readyAgents` - status === 'waiting'
  - `otherAgents` - everything else (disconnected, missing)
- Keep existing rendering for now

**Success Criteria:**
- [ ] Agents correctly categorized by status
- [ ] No visual changes yet
- [ ] TypeCheck passes

---

## Phase 2: Active Agents Section

**Goal:** Show active agents prominently at the top

**Changes:**
- Render active agents first
- Always show expanded view for active agents
- Visual emphasis (highlight background, larger icon)

**Success Criteria:**
- [ ] Active agents appear at top
- [ ] Prompt access is one-click (no expand needed)
- [ ] Visual distinction from other agents

---

## Phase 3: Collapsed Ready Agents

**Goal:** Group ready agents into a single collapsible row

**Changes:**
- Create `CollapsedAgentGroup` component
- Shows count: "Ready (2)"
- Expandable to show individual agents
- Collapsed by default

**Success Criteria:**
- [ ] Ready agents grouped
- [ ] Click to expand shows individual agents
- [ ] Prompt access works when expanded

---

## Phase 4: Other Agents Group

**Goal:** Group disconnected/missing agents

**Changes:**
- Similar to Phase 3 but for non-ready agents
- Different color indicator (warning)
- Shows status in group title

**Success Criteria:**
- [ ] Disconnected/missing agents grouped
- [ ] Clear status indication
- [ ] TypeCheck passes

---

## Phase 5: Polish & Height Reduction

**Goal:** Finalize design and reduce fixed height

**Changes:**
- Adjust padding/spacing for compactness
- Remove `flex-1` to allow natural height
- Test on mobile and desktop
- Ensure dark mode works

**Success Criteria:**
- [ ] Sidebar height reduced
- [ ] Responsive on mobile
- [ ] All tests pass
- [ ] Dark mode verified

---

## Phase Dependencies

```
Phase 1 (Refactor) → Phase 2 (Active) → Phase 3 (Ready)
                                            ↓
                                       Phase 4 (Other) → Phase 5 (Polish)
```

## Estimated Timeline

| Phase | Duration |
|-------|----------|
| Phase 1 | 30 min |
| Phase 2 | 45 min |
| Phase 3 | 1 hour |
| Phase 4 | 30 min |
| Phase 5 | 30 min |
| **Total** | **~3 hours** |

## Current Status

- [ ] Phase 1: Refactor Agent Status Groups
- [ ] Phase 2: Active Agents Section
- [ ] Phase 3: Collapsed Ready Agents
- [ ] Phase 4: Other Agents Group
- [ ] Phase 5: Polish & Height Reduction
