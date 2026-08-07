// RMJ One design tokens (Glass / Luxe DARK)
export const colors = {
  surface: '#0D0D0D',
  onSurface: '#F7F7F7',
  surfaceSecondary: '#1C1C1C',
  onSurfaceSecondary: '#E0E0E0',
  surfaceTertiary: '#262626',
  onSurfaceTertiary: '#C2C2C2',
  surfaceInverse: '#F2F2F2',
  onSurfaceInverse: '#0D0D0D',
  brand: '#C5A059',
  brandPrimary: '#D4AF37',
  onBrandPrimary: '#0D0D0D',
  brandSecondary: '#E5D3B3',
  brandTertiary: '#4A3B18',
  onBrandTertiary: '#E5D3B3',
  success: '#2D5A40',
  onSuccess: '#E0F2E9',
  warning: '#A37D1E',
  onWarning: '#FCF4E3',
  error: '#7A2828',
  onError: '#FCE8E8',
  info: '#2B4A5F',
  onInfo: '#E6F0F7',
  border: '#262626',
  borderStrong: '#3D3D3D',
  divider: '#1F1F1F',
  mutedText: '#8A8A8A',
};

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

export const fonts = {
  display: 'serif' as const, // fallback to system serif — no Google fonts pkgs allowed
  text: 'System' as const,
};

export const images = {
  loginHero:
    'https://images.unsplash.com/photo-1781758333991-c5c59ca7673d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxwcmVtaXVtJTIwamV3ZWxsZXJ5JTIwZGlhbW9uZCUyMHJpbmclMjBwaG90b2dyYXBoeXxlbnwwfHx8fDE3ODYxMjIyMjR8MA&ixlib=rb-4.1.0&q=85',
  goldTexture:
    'https://images.pexels.com/photos/6699772/pexels-photo-6699772.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
};
