// RMJ One design tokens — two named palettes. Originally "Ivory boutique"
// (light) and "Emerald vault" (dark), both warm gold-tinted throughout;
// restyled to a neutral, Claude.ai-like look per Vasu's request — mostly
// white/gray/black surfaces, with the gold brand color pulled back to just
// primary actions and active states instead of tinting every card, border,
// and icon fill. Both palettes share the exact same key shape so any screen
// can swap between them without needing per-key fallbacks.

export type ThemeColors = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  surfaceInverse: string;
  onSurfaceInverse: string;
  brand: string;
  brandPrimary: string;
  onBrandPrimary: string;
  brandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  onSuccess: string;
  warning: string;
  onWarning: string;
  error: string;
  onError: string;
  info: string;
  onInfo: string;
  border: string;
  borderStrong: string;
  divider: string;
  mutedText: string;
};

// Light — near-white, neutral gray surfaces. Gold shows up only on primary
// buttons, active tab state, and key highlights, not as a background tint.
export const lightColors: ThemeColors = {
  surface: '#FAFAF9',
  onSurface: '#1C1C1A',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#2E2E2B',
  surfaceTertiary: '#F1F0EC',
  onSurfaceTertiary: '#6E6D66',
  surfaceInverse: '#1C1C1A',
  onSurfaceInverse: '#FAFAF9',
  brand: '#B8863B',
  brandPrimary: '#B8863B',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#8A6526',
  brandTertiary: '#EFEEE9',
  onBrandTertiary: '#57564F',
  success: '#EAF6EA',
  onSuccess: '#1F6B33',
  warning: '#FBF3E4',
  onWarning: '#8A5A0B',
  error: '#FBEAEA',
  onError: '#8A2323',
  info: '#E7F0F7',
  onInfo: '#1E4E70',
  border: '#E6E5E0',
  borderStrong: '#D6D5CE',
  divider: '#EDECE7',
  mutedText: '#8B8A82',
};

// Dark — near-black, neutral gray surfaces. Same restraint as light: gold is
// reserved for primary actions and active state, not a background tint.
export const darkColors: ThemeColors = {
  surface: '#161615',
  onSurface: '#EDEDEA',
  surfaceSecondary: '#1E1E1C',
  onSurfaceSecondary: '#DEDEDA',
  surfaceTertiary: '#282825',
  onSurfaceTertiary: '#9E9D97',
  surfaceInverse: '#EDEDEA',
  onSurfaceInverse: '#161615',
  brand: '#C9A24B',
  brandPrimary: '#C9A24B',
  onBrandPrimary: '#161615',
  brandSecondary: '#E3C989',
  brandTertiary: '#2A2A27',
  onBrandTertiary: '#B8B7B0',
  success: '#1F4A34',
  onSuccess: '#B7EFC5',
  warning: '#5C4212',
  onWarning: '#F1D890',
  error: '#5C1F1F',
  onError: '#F1A9A9',
  info: '#173A4C',
  onInfo: '#AFD9F0',
  border: '#2E2E2B',
  borderStrong: '#3A3A36',
  divider: '#242422',
  mutedText: '#8B8A82',
};
