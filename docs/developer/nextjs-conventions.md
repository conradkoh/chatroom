# Next.js Conventions

This document records the Next.js conventions we consistently apply in this project. It serves as a reference for maintainers to ensure consistency.

## App Router

We use the Next.js App Router (`app/` directory) for routing.

- Routes are defined by folder structure under `apps/webapp/src/app/`
- Each route segment gets its own folder with a `page.tsx` (or `page.mdx`)
- Layouts, loading states, and error boundaries co-locate with their route segments

### `params` is a Promise

When accessing route parameters in page components, `params` is a Promise and must be awaited:

```tsx
export default async function MyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div>{id}</div>;
}
```

## `loading.tsx`

Loading boundaries provide skeleton UI during navigation between routes.

- Place `loading.tsx` next to `page.tsx` in any route segment
- Export a default component that renders `Skeleton` placeholders
- **Must be a server component** — do not add `'use client'`
- Mimic the page layout structure for a smooth visual transition

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="...">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}
```

## Link Component

Use the built-in Next.js `Link` component for client-side navigation.

- Import from `next/link`
- Use for internal navigations to benefit from prefetching and SPA-like transitions
- Do NOT use `<a>` tags for internal routes

```tsx
import Link from 'next/link';

<Link href="/app/profile">Profile</Link>;
```
