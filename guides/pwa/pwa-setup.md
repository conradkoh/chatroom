# Setting Up a Progressive Web App (PWA) with Next.js

This guide walks you through setting up a Progressive Web App (PWA) using Next.js, based on the configuration used in this repository.

## Overview

A Progressive Web App (PWA) allows users to install your web application on their devices and use it like a native application. The PWA setup in this project includes:

- App icons in multiple sizes
- A favicon
- Manifest file for PWA configuration
- Required metadata in the HTML head

## PWA Setup Process

The setup process is streamlined to make it easy for you to customize your app's appearance:

1. **You provide**: A single SVG source file for your app icon
2. **The system generates**: All required PWA assets (app icons and favicon)

## Step 1: Prepare Your App Icon

Create or obtain an SVG file for your app icon:

1. Place your SVG file at `apps/webapp/public/svg-sources/app-icon.svg`
2. For best results:
   - Use a simple, bold design that works well at small sizes
   - Prefer black icon on white background for maximum compatibility
   - Center the icon within the SVG
   - Include appropriate padding around the icon (at least 20% of the icon size)
   - Use a filled icon rather than an outlined one

### Example SVG Icon Structure

```svg
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- White background circle -->
  <circle cx="256" cy="256" r="256" fill="white"/>

  <!-- Icon centered and scaled to fit nicely -->
  <g transform="translate(146, 96) scale(15)">
    <!-- Your icon path here -->
    <path d="..." fill="black" fill-rule="evenodd" clip-rule="evenodd"/>
  </g>
</svg>
```

## Step 2: Generate PWA Assets

Run the asset generator script to create all required PWA assets:

```bash
# Make sure dependencies are installed
pnpm add -D sharp png-to-ico

# Generate all PWA assets
node apps/webapp/scripts/generate-pwa-assets.js
```

This will create:

- App icons in all required sizes (16×16 to 1024×1024 pixels)
- A favicon.ico file for browser compatibility

After running the script, check the generated assets in the `apps/webapp/public/` directory. If adjustments are needed, modify your SVG source file and run the script again.

## Step 3: Configure Web App Manifest

The manifest file is already configured at `apps/webapp/public/manifest.json`. You may want to customize:

- `name`: The full name of your application
- `short_name`: A shorter name for app launchers
- `description`: A brief description of your app
- `start_url`: The initial URL to load when launching your app
- `theme_color` and `background_color`: Colors used by the browser and OS

Here's what the manifest file looks like:

```json
{
  "name": "Your App Name",
  "short_name": "App Name",
  "description": "Description of your application",
  "icons": [
    {
      "src": "/appicon-16x16.png",
      "sizes": "16x16",
      "type": "image/png"
    },
    // ... other icon sizes ...
    {
      "src": "/appicon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "start_url": "/app",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "orientation": "portrait",
  "scope": "/",
  "prefer_related_applications": false
}
```

## Step 4: Configure Root Layout

Ensure your `app/layout.tsx` file includes the necessary PWA metadata:

```tsx
import type { Metadata } from 'next';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
};

export const metadata: Metadata = {
  title: 'Your App Name',
  description: 'Description of your application',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Your App Name',
  },
  applicationName: 'Your App Name',
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/appicon-192x192.png" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

## Step 5: Testing Your PWA

After completing the setup:

1. Build and run your Next.js app in production mode:

   ```bash
   pnpm run build
   pnpm start
   ```

2. Test PWA installation on different platforms:

   ### For iOS/Safari:
   1. Visit your website in Safari
   2. Tap the Share button (box with arrow)
   3. Scroll down and tap "Add to Home Screen"
   4. Enter a name for the app and tap "Add"

   ### For Android/Chrome:
   1. Visit your website in Chrome
   2. Tap the menu button (three dots)
   3. Tap "Add to Home Screen" or "Install App"
   4. Follow the prompts to install

   ### For Desktop Browsers:

   In compatible browsers, look for the installation icon in the address bar.

## Icon Design Best Practices

For optimal results with your PWA icons:

1. **Use simple, bold designs** that are recognizable at small sizes
2. **Prefer filled icons over outlined ones** for better visibility
3. **Center the icon** both horizontally and vertically
4. **Use black and white** for the default icon to ensure compatibility
5. **Add appropriate padding** (at least 20% of the icon size)
6. **Test on multiple devices** to ensure your icon looks good everywhere
