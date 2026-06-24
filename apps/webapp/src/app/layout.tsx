import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache/provider';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';

import './globals.css';
import { ConvexClientProvider } from '@/app/ConvexClientProvider';
import { Navigation } from '@/components/Navigation';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { Toaster } from '@/components/ui/sonner';
import { getAppTitle } from '@/lib/environment';
import { AppInfoProvider } from '@/modules/app/AppInfoProvider';
import { AuthProvider } from '@/modules/auth/AuthProvider';
import { HeaderPortalProvider } from '@/modules/header/HeaderPortalProvider';
import { SentryErrorBoundary } from '@/modules/sentry/SentryErrorBoundary';
import { ThemeProvider, themeScript } from '@/modules/theme/ThemeProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
};

export const metadata: Metadata = {
  title: getAppTitle(),
  description: 'Chatroom',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: getAppTitle(),
  },
  applicationName: getAppTitle(),
  formatDetection: {
    telephone: false,
  },
};

/**
 * Root layout component that wraps the entire application with providers and global structure.
 * Sets up authentication, theming, navigation, and toast notifications for all pages.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/appicon-192x192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#ffffff" />
        <Script id="theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SentryErrorBoundary>
          <ConvexClientProvider>
            <ConvexQueryCacheProvider>
              <AppInfoProvider>
                <AuthProvider>
                  <ThemeProvider>
                    <HeaderPortalProvider>
                      <div className="flex h-dvh flex-col overflow-hidden bg-background dark:bg-zinc-950">
                        <Navigation />
                        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
                          {children}
                        </main>
                      </div>
                    </HeaderPortalProvider>
                  </ThemeProvider>
                </AuthProvider>
              </AppInfoProvider>
            </ConvexQueryCacheProvider>
          </ConvexClientProvider>
          <Toaster />
          <ServiceWorkerRegistration />
          {/* React Grab for development — afterInteractive to avoid hydration mismatch */}
          {process.env.NODE_ENV === 'development' && (
            <Script
              src="//unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="afterInteractive"
            />
          )}
        </SentryErrorBoundary>
      </body>
    </html>
  );
}
