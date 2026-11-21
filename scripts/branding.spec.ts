import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import {
  applyLandingPageBranding,
  applyLayoutBranding,
  applyManifestBranding,
  applyNavigationBranding,
} from './branding';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// Template strings sourced from BRANDING_CONFIG.templates in scripts/setup.ts.
const TEMPLATE_APP_NAME = 'Next Convex App';
const TEMPLATE_APP_SHORT_NAME = 'Next Convex';
const TEMPLATE_APP_DESCRIPTION = 'A Next.js app with Convex backend';
const TEMPLATE_LANDING_PAGE_TITLE = 'Convex + Next Starter App';

const values = {
  appName: 'Acme Widgets',
  appShortName: 'Acme',
  appDescription: 'Acme description',
  landingPageTitle: 'Welcome to Acme',
};

describe('applyNavigationBranding', () => {
  it('rewrites the single brand constant so loading and resolved states agree', () => {
    const source = read('apps/webapp/src/components/Navigation.tsx');

    // Guard: the transform only works if the template literal is actually present.
    expect(source).toContain(TEMPLATE_APP_SHORT_NAME);

    const output = applyNavigationBranding(source, values.appShortName);

    expect(output).toContain(`const APP_SHORT_NAME = '${values.appShortName}';`);
    expect(output).not.toContain(TEMPLATE_APP_SHORT_NAME);
  });

  it('is idempotent', () => {
    const source = read('apps/webapp/src/components/Navigation.tsx');

    const once = applyNavigationBranding(source, values.appShortName);
    const twice = applyNavigationBranding(once, values.appShortName);

    expect(twice).toBe(once);
  });
});

describe('applyManifestBranding', () => {
  it('removes template strings and writes the new values', () => {
    const source = read('apps/webapp/src/app/manifest.ts');

    expect(source).toContain(TEMPLATE_APP_NAME);
    expect(source).toContain(TEMPLATE_APP_DESCRIPTION);

    const output = applyManifestBranding(source, values);

    expect(output).not.toContain(TEMPLATE_APP_NAME);
    expect(output).not.toContain(TEMPLATE_APP_DESCRIPTION);
    expect(output).toContain(`name: '${values.appName}'`);
    expect(output).toContain(`short_name: '${values.appShortName}'`);
    expect(output).toContain(`description: '${values.appDescription}'`);
  });
});

describe('applyLayoutBranding', () => {
  it('removes template strings and writes the new values', () => {
    const source = read('apps/webapp/src/app/layout.tsx');

    expect(source).toContain(TEMPLATE_APP_NAME);
    expect(source).toContain(TEMPLATE_APP_DESCRIPTION);

    const output = applyLayoutBranding(source, values);

    expect(output).not.toContain(TEMPLATE_APP_NAME);
    expect(output).not.toContain(TEMPLATE_APP_DESCRIPTION);
    expect(output).toContain(`title: '${values.appName}'`);
    expect(output).toContain(`description: '${values.appDescription}'`);
    expect(output).toContain(`applicationName: '${values.appName}'`);
  });
});

describe('applyLandingPageBranding', () => {
  it('removes the template title and writes the new value', () => {
    const source = read('apps/webapp/src/app/page.tsx');

    expect(source).toContain(TEMPLATE_LANDING_PAGE_TITLE);

    const output = applyLandingPageBranding(source, values.landingPageTitle);

    expect(output).not.toContain(TEMPLATE_LANDING_PAGE_TITLE);
    expect(output).toContain(values.landingPageTitle);
  });
});
