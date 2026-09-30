import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shiftedISTDate } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { haptics } from '@/src/utils/haptics';
import { DateField } from '@/src/components/DateField';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const friendly = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/** "Due back" date: one-tap chips for N days from today (IST), or pick any date.
 * Tapping the selected chip again clears it. */
export function DueBackField({ label = 'Due back (optional)', value, onChange, days, testID }: {
  label?: string; value: string; onChange: (v: string) => void; days: number[]; testID?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const options = days.map((n) => ({ n, iso: shiftedISTDate(n) }));
  const matched = options.find((o) => o.iso === value);
  return (
    <View>
      <View style={s.head}>
        <Text style={s.label}>{label}</Text>
        {!!value && <Text style={s.when}>{friendly(value)}</Text>}
      </View>
      <View style={s.chips}>
        {options.map((o) => {
          const on = matched?.n === o.n;
          return (
            <Pressable key={o.n} onPress={() => { haptics.selection(); onChange(on ? '' : o.iso); }}
              style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={`Due back in ${o.n} day${o.n === 1 ? '' : 's'}`} testID={`${testID || 'due-back'}-${o.n}d`}>
              <Text style={[s.chipText, on && s.chipTextOn]}>{o.n} day{o.n === 1 ? '' : 's'}</Text>
            </Pressable>
          );
        })}
      </View>
      <DateField value={value} onChange={onChange} placeholder="Or pick a date" testID={testID} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: 6 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12 },
  when: { color: colors.brandSecondary, fontSize: 12.5, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary, fontWeight: '700' },
});
