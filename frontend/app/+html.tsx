import { ScrollViewStyleReset } from 'expo-router/html';

/**
 * Root HTML document for the web build. Expo Router uses this in place of its
 * default template for every page — see https://docs.expo.dev/router/reference/static-rendering/#root-html.
 *
 * Added here specifically so "Add to Home Screen" on iPhone launches RMJ-One as a
 * full-screen standalone app (no Safari address bar/chrome) instead of just a bookmark
 * that reopens inside the browser.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <title>RMJ-One</title>

        {/* iOS: launch full-screen from the Home Screen icon, no browser chrome */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RMJ-One" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Android / other browsers that support the web app manifest */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0D0D0D" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
