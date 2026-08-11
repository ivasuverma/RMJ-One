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

// "Jost" (a free, Century-Gothic-alike geometric sans) is loaded at runtime
// from a CDN under Expo Go — see src/hooks/use-text-fonts.ts. We don't ship a
// @expo-google-fonts/* npm package, so native/prod builds and web won't have
// it registered; referencing an unregistered family name is a silent no-op
// in React Native, so these safely fall back to the closest built-in system
// font rather than crashing.
import { Platform } from 'react-native';

export const fonts = {
  display: 'Jost-SemiBold',
  displayMedium: 'Jost-Medium',
  text: 'Jost-Regular',
  textMedium: 'Jost-Medium',
  textBold: 'Jost-Bold',
  // Used as an explicit fallback anywhere Jost definitely isn't registered
  // (e.g. native/EAS builds without the CDN load path).
  systemFallback: Platform.select({ ios: 'Futura', android: 'sans-serif-medium', default: 'System' }) as string,
};

export const images = {
  loginHero:
    'https://images.unsplash.com/photo-1781758333991-c5c59ca7673d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxwcmVtaXVtJTIwamV3ZWxsZXJ5JTIwZGlhbW9uZCUyMHJpbmclMjBwaG90b2dyYXBoeXxlbnwwfHx8fDE3ODYxMjIyMjR8MA&ixlib=rb-4.1.0&q=85',
  goldTexture:
    'https://images.pexels.com/photos/6699772/pexels-photo-6699772.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
  logo: require('../assets/images/icon.png'),
};
