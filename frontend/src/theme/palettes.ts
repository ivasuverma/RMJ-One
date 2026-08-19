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

// Dark — the "RMJ One" signature look (matches the v2 design comp): a
// near-black #0B0B0C canvas, layered #161619 / #1E1E22 cards with hairline
// white borders, warm ivory ink, and antique gold reserved for primary
// actions + active state. The semantic tones (success/warning/error/info)
// use the comp's exact tinted-background + saturated-text pairs, so a status
// chip reads as a soft wash of colour, not a solid block.
export const darkColors: ThemeColors = {
  surface: '#0B0B0C',
  onSurface: '#F4F3EF',
  surfaceSecondary: '#161619',
  onSurfaceSecondary: '#B7B6B0',
  surfaceTertiary: '#1E1E22',
  onSurfaceTertiary: '#77766F',
  surfaceInverse: '#F4F3EF',
  onSurfaceInverse: '#0B0B0C',
  brand: '#C9A54E',
  brandPrimary: '#C9A54E',
  onBrandPrimary: '#0B0B0C',
  brandSecondary: '#D9BE7E',
  brandTertiary: '#1E1E22',
  onBrandTertiary: '#D9BE7E',
  success: 'rgba(95,176,126,0.14)',
  onSuccess: '#5FB07E',
  warning: 'rgba(224,168,60,0.14)',
  onWarning: '#E0A83C',
  error: 'rgba(229,105,91,0.15)',
  onError: '#E5695B',
  info: 'rgba(111,155,209,0.14)',
  onInfo: '#6F9BD1',
  border: 'rgba(255,255,255,0.075)',
  borderStrong: 'rgba(255,255,255,0.12)',
  divider: 'rgba(255,255,255,0.075)',
  mutedText: '#77766F',
};
