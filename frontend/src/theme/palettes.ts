// RMJ One design tokens — two named palettes, chosen by Vasu after comparing
// mockups: "Ivory boutique" for light mode, "Emerald vault" for dark mode.
// Both share the exact same key shape so any screen can swap between them
// without needing per-key fallbacks.

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

// "Ivory boutique" — warm, light. Easy to read in bright showroom lighting.
export const lightColors: ThemeColors = {
  surface: '#F7F1E6',
  onSurface: '#2B2118',
  surfaceSecondary: '#FFFFFF',
  onSurfaceSecondary: '#3A2E1F',
  surfaceTertiary: '#EFE4CC',
  onSurfaceTertiary: '#6B5230',
  surfaceInverse: '#2B2118',
  onSurfaceInverse: '#F7F1E6',
  brand: '#B8863B',
  brandPrimary: '#B8863B',
  onBrandPrimary: '#FFFFFF',
  brandSecondary: '#8A6526',
  brandTertiary: '#F0E2C0',
  onBrandTertiary: '#6B5230',
  success: '#EAF6EA',
  onSuccess: '#1F6B33',
  warning: '#FBF0D9',
  onWarning: '#8A5A0B',
  error: '#FBEAEA',
  onError: '#8A2323',
  info: '#E7F0F7',
  onInfo: '#1E4E70',
  border: '#E6D9BE',
  borderStrong: '#D8C6A0',
  divider: '#EDE2C8',
  mutedText: '#9C8A63',
};

// "Emerald vault" — deep green + gold, gemstone-inspired. Dark luxury feel.
export const darkColors: ThemeColors = {
  surface: '#0E211A',
  onSurface: '#EDF3EF',
  surfaceSecondary: '#153428',
  onSurfaceSecondary: '#DCEAE1',
  surfaceTertiary: '#1B4433',
  onSurfaceTertiary: '#9FD6BB',
  surfaceInverse: '#EDF3EF',
  onSurfaceInverse: '#0E211A',
  brand: '#C9A24B',
  brandPrimary: '#C9A24B',
  onBrandPrimary: '#0E211A',
  brandSecondary: '#E3C989',
  brandTertiary: '#22503D',
  onBrandTertiary: '#C9A24B',
  success: '#1F4A34',
  onSuccess: '#B7EFC5',
  warning: '#5C4212',
  onWarning: '#F1D890',
  error: '#5C1F1F',
  onError: '#F1A9A9',
  info: '#173A4C',
  onInfo: '#AFD9F0',
  border: '#22503D',
  borderStrong: '#2E6349',
  divider: '#1B4433',
  mutedText: '#7FA895',
};
