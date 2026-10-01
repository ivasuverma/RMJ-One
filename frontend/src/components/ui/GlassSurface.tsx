import { ReactNode, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/src/theme/ThemeContext';
import { useGlass } from '@/src/theme/glass';

// '#F7F5F0' → 'rgba(247,245,240,a)'
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Apple-style frosted glass for anything that floats over content — sheets,
 * dialogs, toasts, pickers, round header buttons. Uses the same blur and tint
 * as the tab bar and headers (Settings › Glass bar), so one setting drives the
 * whole app.
 *
 * `material` follows iOS: 'thin' for bars and buttons (the setting's tint as is),
 * 'thick' for sheets/dialogs/toasts that carry text over busy content (the tint
 * is raised so they stay readable even when the setting is very clear).
 * `color` is the surface the tint is made of (defaults to the page colour).
 *
 * Web uses the browser's backdrop blur, iOS a native BlurView, Android (blur
 * still experimental there) and blur 0 a solid surface.
 */
export const GlassSurface = forwardRef<View, ViewProps & {
  children?: ReactNode; style?: StyleProp<ViewStyle>; material?: 'thin' | 'thick'; color?: string;
}>(function GlassSurface({ children, style, material = 'thin', color, ...rest }, ref) {
  const { colors, scheme } = useTheme();
  const { blur, tint } = useGlass();
  const glass = blur > 0 && Platform.OS !== 'android';
  const base = color || colors.surfaceSecondary;
  const alpha = material === 'thick' ? 0.55 + (tint / 100) * 0.4 : tint / 100;
  const inner = useRef<View>(null);
  useImperativeHandle(ref, () => inner.current as View);

  // react-native-web drops backdrop-filter from styles, so set it on the element itself.
  useEffect(() => {
    const el = inner.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.style) return;
    const f = glass ? `blur(${blur}px) saturate(180%)` : 'none';
    el.style.setProperty('backdrop-filter', f);
    el.style.setProperty('-webkit-backdrop-filter', f);
  });

  return (
    <View ref={inner} {...rest} style={[style, { backgroundColor: glass ? withAlpha(base, alpha) : base }, glass && Platform.OS === 'ios' && { overflow: 'hidden' }]}>
      {glass && Platform.OS === 'ios' && (
        <BlurView pointerEvents="none" intensity={Math.min(100, blur * 2.5)}
          tint={scheme === 'dark' ? (material === 'thick' ? 'systemThickMaterialDark' : 'systemUltraThinMaterialDark') : (material === 'thick' ? 'systemThickMaterialLight' : 'systemUltraThinMaterialLight')}
          style={StyleSheet.absoluteFill} />
      )}
      {children}
    </View>
  );
});
