import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const TIERS = [0, 1, 3, 5];

// Fixed reward tiers instead of a free-text point count — matches how the
// value is actually shown back to the employee (a star count, see
// (emp)/tasks.tsx), so picking is picking, not typing a number that then
// gets rendered as stars anyway.
export function StarPicker({ value, onChange, testID }: { value: number; onChange: (v: number) => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {TIERS.map((n) => {
        const active = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={[styles.chip, active && styles.chipActive]}
            testID={testID ? `${testID}-${n}` : undefined}
          >
            {n === 0 ? (
              <Text style={[styles.chipText, active && styles.chipTextActive]}>None</Text>
            ) : (
              <>
                <Ionicons name="star" size={13} color={active ? colors.onBrandPrimary : colors.onWarning} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
});
