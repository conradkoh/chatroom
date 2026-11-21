import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import {
  applyLandingPageBranding,
  applyLayoutBranding,
  applyManifestBranding,
  applyNavigationBranding,
} from './branding';

const values = {
  appName: 'Acme Widgets',
  appShortName: 'Acme',
  appDescription: 'Acme description',
  landingPageTitle: 'Welcome to Acme',
};

// Fixtures mirror the shape of each branded file, with literal values where the transform applies.
const manifestFixture = [
  'export default function manifest() {',
  '  return {',
  "    name: 'Old App',",
  "    short_name: 'Old',",
  "    description: 'Old description',",
  "    start_url: '/app',",
  '  };',
  '}',
].join('\n');

const layoutFixture = [
  'export const metadata = {',
  "  title: 'Old App',",
  "  description: 'Old description',",
  '  appleWebApp: {',
  '    capable: true,',
  "    title: 'Old App',",
  '  },',
  "  applicationName: 'Old App',",
  '};',
].join('\n');

const navigationFixture = [
  '// Brand label shown in the header. Keep as a single literal: scripts/branding.ts',
  "// rewrites `const APP_SHORT_NAME = '...';` during branding setup.",
  "const APP_SHORT_NAME = 'Old';",
  '',
  'export function Navigation() {',
  '  return <span>{APP_SHORT_NAME}</span>;',
  '}',
].join('\n');

const landingPageFixture = [
  'export default function Page() {',
  '  return (',
  '    <div>',
  '      <header>Convex + Next Starter App</header>',
  '      <main className="flex-1">',
  '        <h1>Convex + Next Starter App</h1>',
  '      </main>',
  '    </div>',
  '  );',
  '}',
].join('\n');

describe('applyManifestBranding', () => {
  it('rewrites name, short_name and description and leaves other keys alone', () => {
    const output = applyManifestBranding(manifestFixture, values);
    expect(output).toContain(`name: '${values.appName}',`);
    expect(output).toContain(`short_name: '${values.appShortName}',`);
    expect(output).toContain(`description: '${values.appDescription}',`);
    expect(output).toContain("start_url: '/app',");
  });

  it('does not let short_name capture the name rewrite when it comes first', () => {
    const fixture = [
      'export default function manifest() {',
      '  return {',
      "    short_name: 'Old',",
      "    name: 'Old App',",
      '  };',
      '}',
    ].join('\n');
    const output = applyManifestBranding(fixture, values);
    expect(output).toContain(`name: '${values.appName}',`);
    expect(output).toContain(`short_name: '${values.appShortName}',`);
  });

  it('is idempotent', () => {
    const once = applyManifestBranding(manifestFixture, values);
    expect(applyManifestBranding(once, values)).toBe(once);
  });
});

describe('applyLayoutBranding', () => {
  it('rewrites title, description, appleWebApp title and applicationName', () => {
    const output = applyLayoutBranding(layoutFixture, values);
    expect(output).toContain(`title: '${values.appName}',`);
    expect(output).toContain(`description: '${values.appDescription}',`);
    expect(output).toContain(`applicationName: '${values.appName}',`);
    expect(output.match(/title: 'Acme Widgets'/g)?.length).toBe(2);
  });

  it('leaves non-literal title expressions alone, as the fork layout uses getAppTitle()', () => {
    const fixture = layoutFixture.replace("title: 'Old App',", 'title: getAppTitle(),');
    const output = applyLayoutBranding(fixture, values);
    expect(output).toContain('title: getAppTitle(),');
  });

  it('does not rewrite a key that merely ends in title, such as subtitle', () => {
    const fixture = layoutFixture.replace(
      "  title: 'Old App',",
      "  subtitle: 'Keep me',\n  title: 'Old App',"
    );
    expect(applyLayoutBranding(fixture, values)).toContain("subtitle: 'Keep me',");
  });

  it('is idempotent', () => {
    const once = applyLayoutBranding(layoutFixture, values);
    expect(applyLayoutBranding(once, values)).toBe(once);
  });
});

describe('applyNavigationBranding', () => {
  it('rewrites the top-level brand constant', () => {
    const output = applyNavigationBranding(navigationFixture, values.appShortName);
    expect(output).toContain(`const APP_SHORT_NAME = '${values.appShortName}';`);
    expect(output).not.toContain("const APP_SHORT_NAME = 'Old';");
  });

  it('never rewrites comments that mention the constant', () => {
    const output = applyNavigationBranding(navigationFixture, values.appShortName);
    expect(output).toContain("// rewrites `const APP_SHORT_NAME = '...';` during branding setup.");
  });

  it('is idempotent', () => {
    const once = applyNavigationBranding(navigationFixture, values.appShortName);
    expect(applyNavigationBranding(once, values.appShortName)).toBe(once);
  });

  it('finds the brand constant exactly once in the real Navigation.tsx', () => {
    const source = readFileSync(
      new URL('../apps/webapp/src/components/Navigation.tsx', import.meta.url),
      'utf8'
    );
    const output = applyNavigationBranding(source, values.appShortName);
    expect(output).toContain(`const APP_SHORT_NAME = '${values.appShortName}';`);
    expect(output.match(/^const APP_SHORT_NAME = /gm)?.length).toBe(1);
  });
});

describe('applyLandingPageBranding', () => {
  it('rewrites the title inside <main> and leaves text outside it alone', () => {
    const output = applyLandingPageBranding(landingPageFixture, values.landingPageTitle);
    expect(output).toContain(`<h1>${values.landingPageTitle}</h1>`);
    expect(output).toContain('<header>Convex + Next Starter App</header>');
  });

  it('is idempotent', () => {
    const once = applyLandingPageBranding(landingPageFixture, values.landingPageTitle);
    expect(applyLandingPageBranding(once, values.landingPageTitle)).toBe(once);
  });
});
