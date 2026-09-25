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
        <meta name="description" content="RMJ-One — the business app of Ram Murti Jewellers, Ludhiana." />

        {/* Link previews (WhatsApp, Messages, Slack…): the gold logo card */}
        <meta property="og:title" content="RMJ-One" />
        <meta property="og:description" content="The business app of Ram Murti Jewellers, Ludhiana. Staff sign in here." />
        <meta property="og:url" content="https://app.rmj.co.in/" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="RMJ-One" />
        <meta property="og:image" content="https://app.rmj.co.in/og-image.png?v=1" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Ram Murti Jewellers logo" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://app.rmj.co.in/og-image.png?v=1" />

        {/* iOS: launch full-screen from the Home Screen icon, no browser chrome */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RMJ-One" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        <meta name="application-name" content="RMJ-One" />

        {/* Android / other browsers that support the web app manifest */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#161615" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#FAFAF9" media="(prefers-color-scheme: light)" />
        <link rel="manifest" href="/manifest.json?v=2" />
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=3" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=2" />

        {/* Inter — this is the actual production path for custom type. The
            expo-font/useFonts CDN loader in src/hooks/use-text-fonts.ts only
            registers fonts inside the Expo Go client (see its comment); the
            real deployment is a web export, which never went through that
            path, so the app has silently been rendering system fonts this
            whole time. This <link> is what actually gets Inter onto the
            live site. One family, multiple weights — matches how the
            `fonts` tokens in src/theme.ts pair fontFamily with fontWeight. */}
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
          }
          /* Dark canvas from first paint — matches the app's default dark
             theme so there's no white flash before React mounts. */
          html, body { background:#0B0B0C; }
          /* Telegrafico — the logo's wordmark font (freeware, S. Nicolosi), used
             for the RMJ-One title on the login screen. A hyphen glyph was added
             (the original has letters only). Native loads assets/fonts/Telegrafico.ttf. */
          @font-face { font-family: 'Telegrafico'; font-display: swap;
            src: url('/fonts/telegrafico.woff2') format('woff2'), url('/fonts/telegrafico.ttf') format('truetype'); }
        ` }} />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
