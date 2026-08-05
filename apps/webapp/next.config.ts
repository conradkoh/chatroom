import { createRequire } from 'module';
import path from 'path';

import createMDX from '@next/mdx';
import { withSentryConfig } from '@sentry/nextjs';

const require = createRequire(import.meta.url);
const dialogRootContextPath = path.join(
  path.dirname(require.resolve('@base-ui/react/package.json')),
  'dialog/root/DialogRootContext.mjs'
);

const nextConfig = {
  // Configure `pageExtensions` to include markdown and MDX files
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // Enable typed routes for compile-time type safety (moved from experimental in Next.js 16)
  typedRoutes: true,
  // Fix Turbopack workspace root detection in monorepo
  turbopack: {
    root: path.resolve(__dirname, '../../'),
    resolveAlias: {
      '@base-ui/react/dialog/root/DialogRootContext': dialogRootContextPath,
    },
  },
  // Disable when `.next/dev/cache/turbopack` grows unbounded and compaction pegs CPU.
  // Use: TURBOPACK_FS_CACHE=1 pnpm dev to opt in
  experimental: {
    turbopackFileSystemCacheForDev: process.env.TURBOPACK_FS_CACHE === '1',
  },
  webpack: (config: { resolve?: { alias?: Record<string, string> } }) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias['@base-ui/react/dialog/root/DialogRootContext'] = dialogRootContextPath;
    return config;
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
