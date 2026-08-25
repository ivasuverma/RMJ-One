import { useEffect } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { radius } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useReducedMotion } from '@/src/hooks/use-reduced-motion';

/** A subtle pulsing placeholder block — use in place of a bare
 * ActivityIndicator on first load, e.g. a row of these mimicking a stat
 * grid or list while the real data is still in flight. Pulses opacity
 * between 0.5 and 1 on a 900ms loop via reanimated (no timers/setInterval). */
export function Skeleton({ width = '100%', height = 16, radius: r = radius.sm, style }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    // Reduced motion (Apple §14): hold a steady, legible placeholder instead of
    // a looping oscillation (which sits near the flagged ~0.2 Hz range).
    if (reduced) { opacity.value = 0.7; return; }
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 900 }), withTiming(0.5, { duration: 900 })),
      -1,
      true,
    );
  }, [opacity, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        StyleSheet.flatten([{ width, height, borderRadius: r, backgroundColor: colors.surfaceTertiary }]),
        animatedStyle,
        style,
      ]}
    />
  );
}
