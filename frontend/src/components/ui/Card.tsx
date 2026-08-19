import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** Themed surface container — the `surfaceSecondary` card shell repeated
 * across nearly every screen (entry rows, stat blocks, list items). Pass
 * `onPress` to make it tappable; otherwise it's a plain static container. */
export function Card({ children, onPress, style, padded = true, testID }: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  padded?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = [styles.card, padded && styles.padded, style];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [...content, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={content} testID={testID}>{children}</View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.8 },
});
