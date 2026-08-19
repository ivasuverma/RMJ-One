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

// Light — a warm ivory counterpart to the dark comp: soft off-white canvas,
// white cards, warm gold accents, and the same tinted-background + saturated-
// text tone pairs (darkened for contrast on a light surface) so the two
// themes feel like the same product in different light.
export const lightColors: ThemeColors = {
  surface: '#F7F5F0',
  onSurface: '#1A1915',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#565349',
  surfaceTertiary: '#F0EDE6',
  onSurfaceTertiary: '#8B887E',
  surfaceInverse: '#1A1915',
  onSurfaceInverse: '#F7F5F0',
  brand: '#A9812F',
  brandPrimary: '#A9812F',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#7E5E22',
  brandTertiary: '#F3EEE2',
  onBrandTertiary: '#7E5E22',
  success: 'rgba(47,125,81,0.12)',
  onSuccess: '#2C7A4E',
  warning: 'rgba(154,107,18,0.13)',
  onWarning: '#8A5E12',
  error: 'rgba(178,58,46,0.11)',
  onError: '#B23A2E',
  info: 'rgba(58,110,165,0.11)',
  onInfo: '#3A6EA5',
  border: 'rgba(20,18,12,0.09)',
  borderStrong: 'rgba(20,18,12,0.15)',
  divider: 'rgba(20,18,12,0.075)',
  mutedText: '#8B887E',
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
