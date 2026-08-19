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

// Softer, more "Apple" corner radii to match the v2 design comp: hairline
// cards at 18 (lg), inner items/inputs at 14 (md), icon chips at 10 (sm),
// and bottom sheets at 26 (xl).
export const radius = { sm: 10, md: 14, lg: 18, xl: 26, pill: 999 };

// Typography scale — size + weight + lineHeight per role, all on the Inter
// family below. UI primitives (src/components/ui/) consume these instead of
// ad-hoc per-screen font sizes, so headings/body/captions stay consistent as
// more screens migrate onto the shared components.
type TypeStyle = { fontSize: number; fontWeight: '400' | '500' | '600' | '700' | '800'; lineHeight: number };
export const typography: Record<'h1' | 'h2' | 'title' | 'body' | 'bodyMedium' | 'caption' | 'label', TypeStyle> = {
  h1: { fontSize: 26, fontWeight: '700', lineHeight: 32 },
  h2: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
  title: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodyMedium: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  label: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
};

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

// Apple-native type. The v2 design comp is built on the San Francisco system
// font; on the web export this CSS stack resolves to SF Pro on Apple devices
// (iPhone/iPad/Mac — what the shop actually uses), Segoe UI on Windows, and
// Roboto on Android, giving the app a first-party feel without bundling a
// custom face. One family across weights, paired with each component's own
// fontWeight (400–800).
const APPLE_SYSTEM = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif',
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

export const fonts = {
  display: APPLE_SYSTEM,
  displayMedium: APPLE_SYSTEM,
  text: APPLE_SYSTEM,
  textMedium: APPLE_SYSTEM,
  textBold: APPLE_SYSTEM,
  systemFallback: APPLE_SYSTEM,
};

export const images = {
  loginHero:
    'https://images.unsplash.com/photo-1781758333991-c5c59ca7673d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxwcmVtaXVtJTIwamV3ZWxsZXJ5JTIwZGlhbW9uZCUyMHJpbmclMjBwaG90b2dyYXBoeXxlbnwwfHx8fDE3ODYxMjIyMjR8MA&ixlib=rb-4.1.0&q=85',
  goldTexture:
    'https://images.pexels.com/photos/6699772/pexels-photo-6699772.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  logo: require('../assets/images/icon.png'),
};
