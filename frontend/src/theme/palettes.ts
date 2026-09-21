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

// Gives each Cash Book counter its own colour (cycling through the tones
// below by default, or a colour the owner picked explicitly in counter
// settings) so counters — and the whole Cash Book page while that counter
// is open — stay visually distinct at a glance, not just by label. Used by
// both the classic and v2 Cash Book screens.
//
// gold/blue/green/red reuse the theme's existing tinted-background +
// saturated-text pairs; purple/teal/pink/orange aren't semantic tokens used
// elsewhere in the app, so they're hand-tuned per scheme right here — bright
// enough to read clearly on the near-black dark canvas, darkened enough for
// contrast on the light one. Each hue appears exactly once (no near-duplicate
// "gold twice" — the old amber option sat too close to gold and was dropped).
export const counterColorKeys = ['gold', 'blue', 'green', 'red', 'purple', 'teal', 'pink', 'orange'] as const;
export type CounterColorKey = typeof counterColorKeys[number];

const EXTRA_COUNTER_TONES: Record<'light' | 'dark', Record<'purple' | 'teal' | 'pink' | 'orange', { bg: string; text: string }>> = {
  light: {
    purple: { bg: 'rgba(122,82,176,0.11)', text: '#7A52B0' },
    teal: { bg: 'rgba(30,122,116,0.12)', text: '#1E7A74' },
    pink: { bg: 'rgba(178,58,107,0.11)', text: '#B23A6B' },
    orange: { bg: 'rgba(184,96,32,0.12)', text: '#B86020' },
  },
  dark: {
    purple: { bg: 'rgba(180,140,224,0.16)', text: '#C4A6EA' },
    teal: { bg: 'rgba(95,199,194,0.15)', text: '#6FD4CE' },
    pink: { bg: 'rgba(229,143,176,0.16)', text: '#ED9FBE' },
    orange: { bg: 'rgba(224,138,76,0.16)', text: '#EDA067' },
  },
};

export const counterTones = (colors: ThemeColors, scheme: 'light' | 'dark'): Record<CounterColorKey, { bg: string; text: string }> => ({
  gold: { bg: colors.brandTertiary, text: colors.brandSecondary },
  blue: { bg: colors.info, text: colors.onInfo },
  green: { bg: colors.success, text: colors.onSuccess },
  red: { bg: colors.error, text: colors.onError },
  ...EXTRA_COUNTER_TONES[scheme],
});

// Labelled options for a colour-picker UI (Cash Book > counter settings).
export const counterColorOptions = (colors: ThemeColors, scheme: 'light' | 'dark') => {
  const tones = counterTones(colors, scheme);
  return counterColorKeys.map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1), swatch: tones[key].text }));
};

// A counter's chosen colour if it picked one, else a stable cycling fallback
// by list position — so every counter still gets a distinct colour even
// before anyone sets one explicitly.
export const counterToneFor = (colors: ThemeColors, scheme: 'light' | 'dark', color: string | null | undefined, index: number) => {
  const tones = counterTones(colors, scheme);
  if (color && (counterColorKeys as readonly string[]).includes(color)) return tones[color as CounterColorKey];
  return tones[counterColorKeys[index % counterColorKeys.length]];
};
