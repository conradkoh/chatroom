import path from 'path';

import createMDX from '@next/mdx';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  // Configure `pageExtensions` to include markdown and MDX files
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // Enable typed routes for compile-time type safety (moved from experimental in Next.js 16)
  typedRoutes: true,
  // Fix Turbopack workspace root detection in monorepo
  // Points to the monorepo root where pnpm-lock.yaml is located
  // Use absolute path to ensure correct resolution
  turbopack: {
    root: path.resolve(__dirname, '../../'),
  },
  // Disable when `.next/dev/cache/turbopack` grows unbounded and compaction pegs CPU.
  // Use: TURBOPACK_FS_CACHE=0 pnpm dev  (or apps/webapp `pnpm dev:clean` after stopping dev)
  experimental: {
    turbopackFileSystemCacheForDev: process.env.TURBOPACK_FS_CACHE !== '0',
  },
};

const withMDX = createMDX({
  // Add markdown plugins here, as desired
  options: {
    // Enable GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
    // Note: Plugin names as strings for Turbopack compatibility (no require() calls)
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [],
  },
});

// Combine MDX and Next.js config, then wrap with Sentry
const sentryConfig = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || undefined,
});
export default withMDX(sentryConfig);
