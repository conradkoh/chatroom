# Plan 001: Dark/Light Mode Theme Fix - Implementation Phases

## Phase Breakdown

This plan is broken into 6 phases, ordered by priority and dependency. Each phase produces a working system with incrementally better theme support.

---

## Phase 1: Add Light Mode CSS Variables (Critical)

**Description:**  
Add the light mode variant of chatroom CSS variables to `globals.css`. This is the foundation that enables all other fixes.

**Files Modified:**
- `apps/webapp/src/app/globals.css`

**Tasks:**
1. Restructure the `.chatroom-root` CSS variables to be scoped under `.dark .chatroom-root` for dark mode
2. Add new `:root:not(.dark) .chatroom-root` selector with light mode color values per the "Neutral Glass" theme specification
3. Ensure the base `.chatroom-root` class still applies non-color properties (font-family, border-radius, box-sizing reset)

**Success Criteria:**
- [ ] Light mode variables are defined with correct values from design spec
- [ ] Dark mode variables continue to work as before
- [ ] CSS specificity is correct (both selectors have equal precedence)
- [ ] Theme toggle causes chatroom colors to change

---

## Phase 2: Fix Navigation Component (High Priority)

**Description:**  
Update the Navigation header to use semantic tokens instead of hardcoded dark colors.

**Files Modified:**
- `apps/webapp/src/components/Navigation.tsx`

**Tasks:**
1. Replace `bg-zinc-950/95` with appropriate semantic or theme-aware class
2. Replace `text-zinc-100` with `text-foreground`
3. Replace `text-zinc-300` with `text-muted-foreground`
4. Update any other hardcoded color references in the component
5. Ensure login button and user menu adapt to theme

**Success Criteria:**
- [ ] Navigation background adapts to theme
- [ ] Navigation text is readable in both modes
- [ ] Login button is visible in both modes
- [ ] No visual regression in dark mode

---

## Phase 3: Fix ChatroomDashboard Header Portal (High Priority)

**Description:**  
Update the header portal content injected by ChatroomDashboard to use chatroom CSS variables instead of hardcoded zinc colors.

**Files Modified:**
- `apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx`

**Tasks:**
1. Replace all hardcoded `border-zinc-*` classes with `border-chatroom-border` or `border-chatroom-border-strong`
2. Replace all hardcoded `text-zinc-*` classes with appropriate `text-chatroom-text-*` variants
3. Replace all hardcoded `bg-zinc-*` classes with appropriate `bg-chatroom-bg-*` variants
4. Update hover state classes similarly
5. Ensure rename input field adapts to theme
6. Ensure action buttons (back, sidebar toggle, menu) adapt to theme

**Success Criteria:**
- [ ] Back button is visible in both modes
- [ ] Chatroom name text is readable in both modes
- [ ] Team badge is visible in both modes
- [ ] Sidebar toggle button is visible in both modes
- [ ] Action menu button is visible in both modes
- [ ] Rename input field is usable in both modes

---

## Phase 4: Fix Prose/Markdown Styling (Medium Priority)

**Description:**  
Make the markdown/prose content in MessageFeed and PromptModal theme-aware.

**Files Modified:**
- `apps/webapp/src/modules/chatroom/components/MessageFeed.tsx`
- `apps/webapp/src/modules/chatroom/components/PromptModal.tsx`

**Tasks:**
1. Change `prose prose-invert` to `prose dark:prose-invert` in MessageFeed
2. Change `prose prose-invert` to `prose dark:prose-invert` in PromptModal
3. Review prose-specific color overrides (code blocks, links, tables, blockquotes)
4. Update any hardcoded prose colors to use CSS variables where possible
5. Ensure code blocks have appropriate background contrast in both modes

**Success Criteria:**
- [ ] Message content is readable in light mode
- [ ] Prompt preview is readable in light mode
- [ ] Code blocks have visible backgrounds in both modes
- [ ] Links are visible in both modes
- [ ] Tables have visible borders in both modes
- [ ] No visual regression in dark mode prose styling

---

## Phase 5: Audit and Fix Remaining Chatroom Components (Medium Priority)

**Description:**  
Review all other chatroom components for any remaining hardcoded colors that may have been missed.

**Files to Audit:**
- `apps/webapp/src/modules/chatroom/components/ChatroomSelector.tsx`
- `apps/webapp/src/modules/chatroom/components/SendForm.tsx`
- `apps/webapp/src/modules/chatroom/components/AgentPanel.tsx`
- `apps/webapp/src/modules/chatroom/components/TaskQueue.tsx`
- `apps/webapp/src/modules/chatroom/components/SetupChecklist.tsx`
- `apps/webapp/src/modules/chatroom/components/TeamStatus.tsx`
- `apps/webapp/src/modules/chatroom/components/CopyButton.tsx`
- `apps/webapp/src/modules/chatroom/components/ReconnectModal.tsx`
- `apps/webapp/src/modules/chatroom/components/CreateChatroomForm.tsx`
- `apps/webapp/src/modules/chatroom/components/WorkingIndicator.tsx`

**Tasks:**
1. Search for any hardcoded color classes (zinc-*, emerald-*, blue-*, etc.) that aren't status colors
2. Replace non-status hardcoded colors with chatroom CSS variables
3. Verify status colors use the appropriate chatroom status variables
4. Test each component in both light and dark modes

**Success Criteria:**
- [ ] All chatroom components render correctly in light mode
- [ ] All chatroom components render correctly in dark mode
- [ ] Status indicators remain distinguishable in both modes
- [ ] No hardcoded non-status colors remain

---

## Phase 6: Fix Callback and Auth Cards (Low Priority)

**Description:**  
Optionally improve the theme support for callback success/error cards and authentication-related UI.

**Files Modified:**
- `apps/webapp/src/components/CallbackSuccessCard.tsx`
- `apps/webapp/src/components/CallbackErrorCard.tsx`
- `apps/webapp/src/app/recover/page.tsx` (error state styling)

**Tasks:**
1. Review success card green background (`bg-green-100`, `bg-green-600`, etc.)
2. Review error card red background styling
3. Consider using semantic tokens for card backgrounds while keeping status colors for icons/text
4. Ensure contrast meets WCAG AA in both modes
5. Test the recovery page error state in both modes

**Success Criteria:**
- [ ] Success cards are readable in both modes
- [ ] Error cards are readable in both modes  
- [ ] Status colors remain meaningful (green = success, red = error)
- [ ] Recovery page error messages are visible in both modes

---

## Phase Dependencies

```
Phase 1 (CSS Variables)
    ↓
    ├── Phase 2 (Navigation)
    ├── Phase 3 (Dashboard Header)
    ├── Phase 4 (Prose Styling)
    └── Phase 5 (Component Audit)
            ↓
        Phase 6 (Callback Cards) [Optional]
```

- **Phase 1** is required before all other phases
- **Phases 2-5** can be done in parallel after Phase 1
- **Phase 6** is optional and can be deferred

---

## Verification Checklist

After all phases are complete:

- [ ] Toggle theme from dark to light - all chatroom components adapt
- [ ] Toggle theme from light to dark - no visual regression
- [ ] Use "system" theme with OS light mode - app uses light theme
- [ ] Use "system" theme with OS dark mode - app uses dark theme
- [ ] All text has sufficient contrast (4.5:1 minimum)
- [ ] All interactive elements are visible and usable
- [ ] Status colors are distinguishable in both modes
- [ ] Theme transitions are smooth (no flickering)
