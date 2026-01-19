# Plan 014: PRD - Backlog Editor UX Improvements

## Problem Statement

The desktop sidebar and backlog editing experience has poor UX:

1. **Sidebar width too thin** - Content feels cramped
2. **Modal too small for editing** - 512px max-width not enough for markdown
3. **No preview while editing** - Can't see formatted output until save
4. **Height constrained** - Long content requires excessive scrolling

Mobile UX is acceptable, but desktop users need more space.

## User Stories

### As a user editing a long backlog item:
> I want a larger editing area with live preview so I can write detailed markdown requirements comfortably

### As a user reviewing backlog content:
> I want to see the full content without excessive scrolling in a narrow modal

### As a power user on desktop:
> I want to use my large screen effectively, not be constrained to a mobile-sized modal

## Requirements

### Functional

1. **Larger modal on desktop (lg:)**
   - Width: `max-w-5xl` (1024px) instead of `max-w-lg` (512px)
   - Height: `max-h-[90vh]` for more vertical space

2. **Split-panel editing on desktop**
   - Left panel: Markdown editor (textarea)
   - Right panel: Live rendered preview
   - Both panels independently scrollable

3. **Mobile unchanged**
   - Current behavior preserved for screens < 1024px
   - Single-panel view continues to work

### Non-Functional

1. **Responsive** - Transitions smoothly at breakpoint
2. **Fast** - Preview updates without lag
3. **Accessible** - Keyboard navigation works
4. **Dark mode** - Proper colors in both themes

## UI Mockup

### Desktop Editing Mode (≥1024px)

```
┌────────────────────────────────────────────────────────────────────┐
│ Backlog Item                                                  [X]  │
├────────────────────────────────────────────────────────────────────┤
│ │ EDITOR                   ║ PREVIEW                              │
│ │────────────────────────────────────────────────────────────────│ │
│ │ # Feature Requirements   ║ Feature Requirements                 │
│ │                          ║ ────────────────────                 │
│ │ ## Overview              ║ Overview                             │
│ │ This feature adds...     ║ This feature adds...                 │
│ │                          ║                                      │
│ │ ## Technical Specs       ║ Technical Specs                      │
│ │ - Use React 18           ║ • Use React 18                       │
│ │ - Add unit tests         ║ • Add unit tests                     │
│ │                          ║                                      │
│ │ ```typescript            ║ ┌───────────────────────────┐        │
│ │ const example = true;    ║ │ const example = true;     │        │
│ │ ```                      ║ └───────────────────────────┘        │
│ │                          ║                                      │
├────────────────────────────────────────────────────────────────────┤
│ [Save] [Cancel]                                 [Move to Queue]    │
└────────────────────────────────────────────────────────────────────┘
```

### Mobile/Tablet View Mode (< 1024px)

Current behavior unchanged:
- Single-panel modal
- Toggle between edit and view

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Modal width (desktop) | 512px | 1024px |
| Modal height (desktop) | 85vh | 90vh |
| Preview while editing | No | Yes (desktop) |
| Click to toggle edit/preview | N/A | 0 (always visible) |

## Risks

| Risk | Mitigation |
|------|------------|
| Performance with large content | Debounce preview updates if needed |
| Layout shift at breakpoint | Test transition thoroughly |
| Existing flows broken | Preserve all existing functionality |

## Out of Scope

- Sidebar width changes (separate issue)
- Syntax highlighting
- Rich text editing
- File attachments
