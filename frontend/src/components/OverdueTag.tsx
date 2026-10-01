import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { todayIST } from '@/src/utils/datetime';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** Whole days a YYYY-MM-DD date is behind today (IST); 0 or less = not late. */
export function daysLate(due?: string | null): number {
  if (!due) return 0;
  const t = new Date(`${todayIST()}T00:00:00Z`).getTime();
  const d = new Date(`${due.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((t - d) / 86400000);
}

/** Red tag on a list card: "Overdue from Ramesh · 3 days" / "Overdue to customer · 1 day". */
export function OverdueTag({ text, days, testID }: { text: string; days: number; testID?: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={s.tag} testID={testID}>
      <Ionicons name="alarm-outline" size={12} color={colors.onError} />
      <Text style={s.text} numberOfLines={1}>{text} · {days} day{days === 1 ? '' : 's'}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.error, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginTop: 5, maxWidth: '100%' },
  text: { color: colors.onError, fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
});
