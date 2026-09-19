import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type LedgerFilterValue = { q: string; from: string; to: string };

// Search + date range for the Loss / Metal ledger screens. Dates are typed as 2026-09-30; a half-typed or invalid
// date is simply ignored until it is complete, so the list never flashes an error while someone is typing.
export const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const filterQuery = (f: LedgerFilterValue) =>
  [f.q.trim() && `q=${encodeURIComponent(f.q.trim())}`, isDate(f.from) && `date_from=${f.from}`, isDate(f.to) && `date_to=${f.to}`].filter(Boolean).join('&');

export function LedgerFilter({ value, onChange, placeholder }: { value: LedgerFilterValue; onChange: (v: LedgerFilterValue) => void; placeholder?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const active = !!(value.q || value.from || value.to);
  return (
    <View style={styles.wrap} testID="ledger-filter">
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.mutedText} />
        <TextInput value={value.q} onChangeText={(q) => onChange({ ...value, q })} placeholder={placeholder || 'Search'} placeholderTextColor={colors.mutedText} style={styles.input} testID="ledger-filter-q" />
        {active ? <Pressable onPress={() => onChange({ q: '', from: '', to: '' })} hitSlop={8} testID="ledger-filter-clear"><Ionicons name="close-circle" size={17} color={colors.mutedText} /></Pressable> : null}
      </View>
      <View style={styles.dates}>
        <TextInput value={value.from} onChangeText={(from) => onChange({ ...value, from })} placeholder="From 2026-09-01" placeholderTextColor={colors.mutedText} style={[styles.dateInput, value.from && !isDate(value.from) && styles.dateBad]} testID="ledger-filter-from" />
        <TextInput value={value.to} onChangeText={(to) => onChange({ ...value, to })} placeholder="To 2026-09-30" placeholderTextColor={colors.mutedText} style={[styles.dateInput, value.to && !isDate(value.to) && styles.dateBad]} testID="ledger-filter-to" />
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  input: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 10 },
  dates: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, fontSize: 13, paddingHorizontal: spacing.md, paddingVertical: 9 },
  dateBad: { borderColor: colors.onError },
});
