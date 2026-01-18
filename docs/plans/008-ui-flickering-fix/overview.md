# Plan 008: Fix UI Flickering on Load

## Summary

Fix the flickering of the agent side panel and chat input panel that occurs during initial page load. The flickering is caused by React hooks that initialize with a default value and then update after hydration.

## Root Cause

Two hooks cause the flickering:

1. **`useIsSmallScreen()`** in `ChatroomDashboard.tsx`
   - Initializes `isSmall = false` (assumes desktop)
   - Updates in useEffect after checking `window.innerWidth`
   - Causes layout shift: sidebar position flickers between `fixed` and `relative`

2. **`useIsTouchDevice()`** in `SendForm.tsx`
   - Initializes `isTouch = false`
   - Updates in useEffect after checking touch capability
   - May cause layout/behavior changes on mobile

## Goals

1. Eliminate visible flickering during initial page load
2. Maintain responsive behavior (desktop vs mobile layouts)
3. Keep SSR compatibility (can't access `window` during server render)

## Non-Goals

- Complete rewrite of responsive logic
- Adding new responsive breakpoints

## Solution Approach

Add a `mounted` state that prevents rendering layout-dependent content until after hydration:

```tsx
function useIsSmallScreen() {
  const [mounted, setMounted] = useState(false);
  const [isSmall, setIsSmall] = useState(false);

  useEffect(() => {
    setMounted(true);
    const checkSize = () => setIsSmall(window.innerWidth < 768);
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  // Return undefined during SSR/hydration
  return mounted ? isSmall : undefined;
}
```

Then in the component:
```tsx
const isSmallScreen = useIsSmallScreen();

// Show loading state until hydrated
if (isSmallScreen === undefined) {
  return <LoadingSpinner />;
}
```

## Files to Modify

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx` | Update `useIsSmallScreen` hook |
| `apps/webapp/src/modules/chatroom/components/SendForm.tsx` | Update `useIsTouchDevice` hook |

## Success Criteria

1. No visible layout flickering on page load
2. Sidebar correctly positions immediately after loading spinner
3. Touch detection works correctly on mobile devices
