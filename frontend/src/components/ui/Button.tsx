import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * Themed action button — the one primitive nearly every screen already
 * hand-rolls its own version of (saveBtn/fab/ctaBtn/etc. across the app).
 * Gold (`brandPrimary`) is reserved for `primary` only, per the design
 * guardrails — `secondary`/`ghost`/`danger` never use it as a fill.
 */
export function Button({
  label, onPress, variant = 'primary', size = 'md', loading = false, disabled = false,
  leftIcon, fullWidth = true, testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const v = variantStyle(colors)[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: v.borderWidth },
        !fullWidth && { alignSelf: 'flex-start' },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <View style={styles.content}>
          {!!leftIcon && <Ionicons name={leftIcon} size={size === 'sm' ? 14 : 16} color={v.fg} />}
          <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: v.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const variantStyle = (colors: ThemeColors): Record<ButtonVariant, { bg: string; fg: string; border: string; borderWidth: number }> => ({
  primary: { bg: colors.brandPrimary, fg: colors.onBrandPrimary, border: colors.brandPrimary, borderWidth: 0 },
  secondary: { bg: colors.surfaceSecondary, fg: colors.onSurface, border: colors.border, borderWidth: 1 },
  ghost: { bg: 'transparent', fg: colors.onSurfaceSecondary, border: 'transparent', borderWidth: 0 },
  danger: { bg: 'transparent', fg: colors.onError, border: colors.error, borderWidth: 1 },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sizeMd: { paddingVertical: 13, paddingHorizontal: spacing.lg },
  sizeSm: { paddingVertical: 9, paddingHorizontal: spacing.md },
  content: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  labelSm: { fontSize: 12.5 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
