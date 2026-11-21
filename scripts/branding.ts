/**
 * Pure content transforms for application branding.
 *
 * Each `apply*Branding` function takes the current file content and returns the
 * rewritten content. File IO and call sequencing live in `setup.ts`, so these
 * transforms can be unit tested without importing the setup script (which runs
 * on module load).
 */

export type ManifestBrandingValues = {
  appName: string;
  appShortName: string;
  appDescription: string;
};

export type LayoutBrandingValues = {
  appName: string;
  appDescription: string;
};

export function applyManifestBranding(content: string, v: ManifestBrandingValues): string {
  return content
    .replace(/name: ['"].*?['"]/, `name: '${v.appName}'`)
    .replace(/short_name: ['"].*?['"]/, `short_name: '${v.appShortName}'`)
    .replace(/description: ['"].*?['"]/, `description: '${v.appDescription}'`);
}

export function applyLayoutBranding(content: string, v: LayoutBrandingValues): string {
  let out = content.replace(/title: ['"].*?['"]/, `title: '${v.appName}'`);
  out = out.replace(/description: ['"].*?['"]/, `description: '${v.appDescription}'`);
  out = out.replace(/appleWebApp:\s*\{[^}]*title: ['"].*?['"]/s, (match) =>
    match.replace(/title: ['"].*?['"]/, `title: '${v.appName}'`)
  );
  return out.replace(/applicationName: ['"].*?['"]/, `applicationName: '${v.appName}'`);
}

export function applyNavigationBranding(content: string, appShortName: string): string {
  // Targets the single brand constant in Navigation.tsx. Anchored to a top-level
  // statement so a comment that mentions the constant is never rewritten.
  return content.replace(
    /^const APP_SHORT_NAME = ['"].*?['"];/m,
    `const APP_SHORT_NAME = '${appShortName}';`
  );
}

export function applyLandingPageBranding(content: string, landingPageTitle: string): string {
  return content.replace(
    /(<main[^>]*>[\s\S]*?)\bConvex \+ Next Starter App\b/,
    `$1${landingPageTitle}`
  );
}
