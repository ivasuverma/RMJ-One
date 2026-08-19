import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import type { Tone } from './StatTile';

/** Small status pill — "Present", "Overdue", "Delivered", etc. Reuses the
 * same tone palette as StatTile so a status word and a stat tile agree on
 * what "warning" or "error" looks like across the app. */
export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: Tone; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = TONE_COLORS(colors)[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]} testID={testID}>
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const TONE_COLORS = (colors: ThemeColors): Record<Tone, { bg: string; border: string; fg: string }> => ({
  neutral: { bg: colors.surfaceTertiary, border: colors.border, fg: colors.onSurfaceSecondary },
  brand: { bg: colors.brandTertiary, border: colors.brand, fg: colors.brandSecondary },
  success: { bg: colors.success, border: colors.success, fg: colors.onSuccess },
  warning: { bg: colors.warning, border: colors.warning, fg: colors.onWarning },
  error: { bg: colors.error, border: colors.error, fg: colors.onError },
  info: { bg: colors.info, border: colors.info, fg: colors.onInfo },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  pill: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1,
  },
  text: { fontSize: 11, fontWeight: '700' },
});
