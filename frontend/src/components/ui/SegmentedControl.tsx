import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, pressedOpacity, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { haptics } from '@/src/utils/haptics';

export type SegmentOption = { key: string; label: string };

/** Fixed-width segmented switch — e.g. Received/Paid on a Cash Book entry
 * form, or Timeline/Details/Payroll on an employee profile. Unlike
 * FilterChips (horizontal-scroll, variable width), segments split the full
 * row evenly and don't scroll. */
export function SegmentedControl({ options, value, onChange, testID }: {
  options: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row} testID={testID}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => { if (!active) { haptics.selection(); onChange(o.key); } }}
            style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && { opacity: pressedOpacity }]}
            testID={testID ? `${testID}-${o.key}` : undefined}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  segment: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  text: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  textActive: { color: colors.onBrandPrimary },
});
