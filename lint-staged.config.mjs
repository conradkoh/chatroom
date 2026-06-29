import fs from 'fs';

/** Convex codegen output — never lint or format in pre-commit. */
const CONVEX_GENERATED = /[/\\]convex[/\\]_generated[/\\]/;

/** @param {string[]} files */
function excludeConvexGenerated(files) {
  return files.filter((file) => !CONVEX_GENERATED.test(file));
}

/** @param {string[]} files */
function excludeSymlinks(files) {
  return files.filter((file) => {
    try {
      return !fs.lstatSync(file).isSymbolicLink();
    } catch {
      return true;
    }
  });
}

/** @type {import('lint-staged').Config} */
export default {
  '**/*.{ts,tsx,js,jsx}': (files) => {
    const filtered = excludeConvexGenerated(files);
    if (!filtered.length) return [];
    const paths = filtered.map((f) => JSON.stringify(f)).join(' ');
    return [`eslint --fix --no-warn-ignored ${paths}`, `prettier --write ${paths}`];
  },
  '**/*.{json,md,css,scss,yml,mdx}': (files) => {
    const filtered = excludeSymlinks(files);
    if (!filtered.length) return [];
    const paths = filtered.map((f) => JSON.stringify(f)).join(' ');
    return [`prettier --write ${paths}`];
  },
};
