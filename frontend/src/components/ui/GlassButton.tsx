import { forwardRef } from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { useTheme } from '@/src/theme/ThemeContext';

/**
 * A round (or rounded) icon button made of glass — drop-in for a Pressable whose
 * style draws a filled circle (back, close, add, menu…). The glass layer sits
 * behind the icon with the button's own corner radius and follows Settings ›
 * Glass bar; the button's own background colour becomes the glass colour.
 */
export const GlassButton = forwardRef<View, PressableProps & { style?: StyleProp<ViewStyle> }>(function GlassButton(
  { style, children, ...rest }, ref,
) {
  const { colors } = useTheme();
  const flat = (StyleSheet.flatten(style) || {}) as ViewStyle;
  const color = typeof flat.backgroundColor === 'string' ? flat.backgroundColor : undefined;
  // A deliberately coloured button (gold "add", red "delete"…) stays solid; only the
  // neutral surface-coloured ones turn to glass.
  const neutral = !color || [colors.surface, colors.surfaceSecondary, colors.surfaceTertiary].includes(color);
  if (!neutral) {
    return (
      <Pressable ref={ref} {...rest} style={({ pressed }) => [style, pressed && { opacity: 0.85, transform: [{ scale: 0.95 }] }]}>
        {children}
      </Pressable>
    );
  }
  return (
    <Pressable ref={ref} {...rest}
      style={({ pressed }) => [style, { backgroundColor: 'transparent' }, pressed && { opacity: 0.85, transform: [{ scale: 0.95 }] }]}>
      {(state) => (
        <>
          <GlassSurface pointerEvents="none" color={color}
            style={[StyleSheet.absoluteFill, { borderRadius: flat.borderRadius ?? 20 }]} />
          {typeof children === 'function' ? children(state) : children}
        </>
      )}
    </Pressable>
  );
});
