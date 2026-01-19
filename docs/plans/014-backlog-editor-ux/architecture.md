# Plan 014: Architecture - Backlog Editor UX

## Current Design

```
┌─────────────────────────────────────────────────────────────────┐
│ TaskDetailModal (max-w-lg = 512px)                              │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Status: Backlog                                     [X]     │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │                                                             │ │
│ │  Content displayed here...                                  │ │
│ │  (or textarea when editing)                                 │ │
│ │                                                             │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ [Edit] [Delete]                           [Move to Queue]   │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Issues:**
- Narrow width (512px) not suitable for long markdown
- Single-panel editing - can't preview while typing
- Same layout for mobile and desktop

## Proposed Design

### Desktop View (lg:)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ TaskDetailModal (max-w-5xl = 1024px or wider)                                  │
├────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────┐ │
│ │ Status: Backlog                                                     [X]    │ │
│ ├────────────────────────────────────┬───────────────────────────────────────┤ │
│ │ EDITOR                             │ PREVIEW                               │ │
│ │ ┌────────────────────────────────┐ │ ┌───────────────────────────────────┐ │ │
│ │ │                                │ │ │                                   │ │ │
│ │ │  # Requirements                │ │ │  Requirements                     │ │ │
│ │ │                                │ │ │  ───────────                      │ │ │
│ │ │  - Item 1                      │ │ │  • Item 1                         │ │ │
│ │ │  - Item 2                      │ │ │  • Item 2                         │ │ │
│ │ │  - Item 3                      │ │ │  • Item 3                         │ │ │
│ │ │                                │ │ │                                   │ │ │
│ │ │                                │ │ │                                   │ │ │
│ │ │                                │ │ │                                   │ │ │
│ │ └────────────────────────────────┘ │ └───────────────────────────────────┘ │ │
│ ├────────────────────────────────────┴───────────────────────────────────────┤ │
│ │ [Save] [Cancel]                                          [Move to Queue]   │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile View (default)

```
┌─────────────────────────────────────┐
│ TaskDetailModal (full width)        │
├─────────────────────────────────────┤
│ Status: Backlog                 [X] │
├─────────────────────────────────────┤
│ [Edit] [Preview]   ← Tab toggle     │
├─────────────────────────────────────┤
│                                     │
│ Content or Editor (based on tab)    │
│                                     │
├─────────────────────────────────────┤
│ [Save/Cancel] or [Edit] [Delete]    │
└─────────────────────────────────────┘
```

## Component Changes

### `TaskDetailModal.tsx`

**Current responsive classes:**
```tsx
md:w-[95%] md:max-w-lg md:max-h-[85vh]
```

**Proposed responsive classes:**
```tsx
// Mobile: near full screen
inset-x-2 top-16 bottom-2

// Tablet (md): current behavior
md:w-[95%] md:max-w-lg md:max-h-[85vh]

// Desktop (lg): expanded view
lg:max-w-5xl lg:max-h-[90vh]
```

**New editing layout:**
```tsx
{isEditing && isDesktop ? (
  <div className="flex flex-1 min-h-0">
    {/* Editor Panel */}
    <div className="w-1/2 p-4 border-r-2 border-chatroom-border">
      <textarea ... />
    </div>
    {/* Preview Panel */}
    <div className="w-1/2 p-4 overflow-y-auto">
      <Markdown>{editedContent}</Markdown>
    </div>
  </div>
) : (
  // Current single-panel view
)}
```

## Breakpoint Strategy

| Breakpoint | Width | Behavior |
|------------|-------|----------|
| Default | < 768px | Current mobile layout |
| md | 768-1023px | Current tablet layout |
| lg | ≥ 1024px | New desktop layout with split view |

## Hook for Breakpoint Detection

```tsx
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  
  return isDesktop;
}
```
