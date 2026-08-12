// RMJ One design tokens.
// `colors` used to be a single static (dark) palette exported from here.
// It's now resolved at runtime via useTheme() (src/theme/ThemeContext.tsx) so
// the app can switch between the "Ivory boutique" light palette and the
// "Emerald vault" dark palette (src/theme/palettes.ts) — following the
// system's light/dark setting, with an optional manual override in Settings.
export type { ThemeColors } from './theme/palettes';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

// "Inter" — clean neutral grotesque-sans, the closest widely-available match
// to Claude.ai's own UI typeface (which is proprietary and can't be bundled
// here). RMJ-One's real deployment is a web export (see app/+html.tsx, which
// loads Inter from Google Fonts) — not a native/EAS build — so the family
// name below is the plain CSS name, one family shared across weights, paired
// with each component's own `fontWeight` style (400/500/600/700/800 are all
// loaded). The CDN loader in src/hooks/use-text-fonts.ts is a secondary path
// that only registers fonts inside the Expo Go client for local dev preview
// on a phone; it's harmless to leave running but isn't what production uses.
import { Platform } from 'react-native';

export const fonts = {
  display: 'Inter',
  displayMedium: 'Inter',
  text: 'Inter',
  textMedium: 'Inter',
  textBold: 'Inter',
  // Used as an explicit fallback anywhere Inter definitely isn't loaded
  // (e.g. a native/EAS build, which wouldn't have the web <link> either).
  systemFallback: Platform.select({ ios: 'Helvetica Neue', android: 'sans-serif-medium', default: 'System' }) as string,
};

export const images = {
  loginHero:
    'https://images.unsplash.com/photo-1781758333991-c5c59ca7673d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxwcmVtaXVtJTIwamV3ZWxsZXJ5JTIwZGlhbW9uZCUyMHJpbmclMjBwaG90b2dyYXBoeXxlbnwwfHx8fDE3ODYxMjIyMjR8MA&ixlib=rb-4.1.0&q=85',
  goldTexture:
    'https://images.pexels.com/photos/6699772/pexels-photo-6699772.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  logo: require('../assets/images/icon.png'),
};
