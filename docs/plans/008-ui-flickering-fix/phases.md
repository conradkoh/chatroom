# Phases: UI Flickering Fix

## Phase Breakdown

### Phase 1: Fix useIsSmallScreen hook

**File:** `apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx`

**Changes:**
1. Add `mounted` state to track hydration
2. Return `undefined` until mounted
3. Update component to handle undefined state (already has loading spinner)

**Before:**
```tsx
function useIsSmallScreen() {
  const [isSmall, setIsSmall] = useState(false);
  
  useEffect(() => {
    const checkSize = () => setIsSmall(window.innerWidth < 768);
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  return isSmall;
}
```

**After:**
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

  // Return undefined during SSR/hydration to trigger loading state
  return mounted ? isSmall : undefined;
}
```

### Phase 2: Update ChatroomDashboard loading check

**File:** `apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx`

**Changes:**
1. Update loading check to include `isSmallScreen === undefined`

**Before:**
```tsx
if (chatroom === undefined || participants === undefined || readiness === undefined) {
  return <LoadingSpinner />;
}
```

**After:**
```tsx
if (chatroom === undefined || participants === undefined || readiness === undefined || isSmallScreen === undefined) {
  return <LoadingSpinner />;
}
```

### Phase 3: Fix useIsTouchDevice hook

**File:** `apps/webapp/src/modules/chatroom/components/SendForm.tsx`

**Changes:**
1. Add `mounted` state to track hydration
2. Return `undefined` until mounted
3. Component handles undefined gracefully (defaults to non-touch behavior)

---

## Summary

| Phase | File | Change |
|-------|------|--------|
| 1 | ChatroomDashboard.tsx | Add `mounted` state to `useIsSmallScreen` |
| 2 | ChatroomDashboard.tsx | Add `isSmallScreen` to loading check |
| 3 | SendForm.tsx | Add `mounted` state to `useIsTouchDevice` |

## Verification

1. Load chatroom page on desktop - no flickering
2. Load chatroom page on mobile - no flickering
3. Sidebar correctly positioned after load
4. Touch/non-touch behavior correct on respective devices
