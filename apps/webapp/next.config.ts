import path from 'path';

import createMDX from '@next/mdx';
import { withSentryConfig } from '@sentry/nextjs';

const turbopackRoot = path.resolve(__dirname, '../../');

const nextConfig = {
  // Configure `pageExtensions` to include markdown and MDX files
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // Enable typed routes for compile-time type safety (moved from experimental in Next.js 16)
  typedRoutes: true,
  // Fix Turbopack workspace root detection in monorepo
  turbopack: {
    root: turbopackRoot,
  },
  // Disable Turbopack filesystem cache for dev — prevents unbounded `.next/dev/cache/turbopack` growth
  // and CPU pegging during compaction. See: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache
  experimental: {
    turbopackFileSystemCacheForDev: false,
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
