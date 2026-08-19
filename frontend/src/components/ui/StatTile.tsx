import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type Tone = 'brand' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** A single glance-stat tile (icon + value + label), tinted by tone. Used
 * for dashboard headline numbers and per-section counts — generalized from
 * the StatCard that used to live only in dashboard.tsx. Colour is reserved
 * for tones that need attention (success/warning/error/info); `neutral`
 * stays on plain surface colors for numbers that are just informational. */
export function StatTile({ icon, label, value, tone = 'neutral', onPress, basis, testID }: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: Tone;
  onPress?: () => void;
  basis?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = TONE_COLORS(colors)[tone];

  const inner = (
    <>
      {!!icon && (
        <View style={[styles.iconWrap, { backgroundColor: t.iconBg }]}>
          <Ionicons name={icon} size={16} color={t.fg} />
        </View>
      )}
      <Text style={[styles.value, { color: t.fg }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={2}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          styles.tile, { backgroundColor: t.bg, borderColor: t.border, flexBasis: basis } as any,
          pressed && { opacity: 0.8 },
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={[styles.tile, { backgroundColor: t.bg, borderColor: t.border, flexBasis: basis } as any]} testID={testID}>
      {inner}
    </View>
  );
}

const TONE_COLORS = (colors: ThemeColors): Record<Tone, { bg: string; border: string; iconBg: string; fg: string }> => ({
  neutral: { bg: colors.surfaceSecondary, border: colors.border, iconBg: colors.brandTertiary, fg: colors.onSurface },
  brand: { bg: colors.brandTertiary, border: colors.brand, iconBg: colors.surface, fg: colors.brandSecondary },
  success: { bg: colors.success, border: colors.success, iconBg: colors.surface, fg: colors.onSuccess },
  warning: { bg: colors.warning, border: colors.warning, iconBg: colors.surface, fg: colors.onWarning },
  error: { bg: colors.error, border: colors.error, iconBg: colors.surface, fg: colors.onError },
  info: { bg: colors.info, border: colors.info, iconBg: colors.surface, fg: colors.onInfo },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  tile: {
    flexGrow: 1, minWidth: 92,
    borderRadius: radius.sm, borderWidth: 1, padding: spacing.sm,
  },
  iconWrap: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  value: { fontSize: 15, fontWeight: '700', fontFamily: fonts.display },
  label: { fontSize: 10, marginTop: 1, opacity: 0.85 },
});
