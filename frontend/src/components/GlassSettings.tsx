import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { BLUR_RANGE, GLASS_DEFAULT, TINT_RANGE, setGlass, useGlass } from '@/src/theme/glass';

// Settings › Glass bar — blur and tint of the frosted bottom bar. Changes
// apply live, so the bar at the bottom of this very screen is the preview.
export function GlassSettings({ testID = 'glass-settings' }: { testID?: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const g = useGlass();
  const [open, setOpen] = useState(false);
  const isDefault = g.blur === GLASS_DEFAULT.blur && g.tint === GLASS_DEFAULT.tint;

  const stepper = (label: string, hint: string, value: number, unit: string, r: typeof BLUR_RANGE, on: (v: number) => void, key: string) => (
    <View style={s.stepRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.stepLabel}>{label}</Text>
        <Text style={s.stepHint}>{hint}</Text>
      </View>
      <Pressable onPress={() => on(Math.max(r.min, value - r.step))} disabled={value <= r.min} style={[s.btn, value <= r.min && s.off]}
        accessibilityRole="button" accessibilityLabel={`Less ${label.toLowerCase()}`} testID={`${testID}-${key}-minus`}>
        <Ionicons name="remove" size={18} color={colors.onSurface} />
      </Pressable>
      <Text style={s.value} testID={`${testID}-${key}-value`}>{value === 0 && key === 'blur' ? 'Off' : `${value}${unit}`}</Text>
      <Pressable onPress={() => on(Math.min(r.max, value + r.step))} disabled={value >= r.max} style={[s.btn, value >= r.max && s.off]}
        accessibilityRole="button" accessibilityLabel={`More ${label.toLowerCase()}`} testID={`${testID}-${key}-plus`}>
        <Ionicons name="add" size={18} color={colors.onSurface} />
      </Pressable>
    </View>
  );

  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]} testID={testID}
        accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={s.rowIcon}><Ionicons name="layers-outline" size={22} color={colors.brandSecondary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowLabel} numberOfLines={1}>Glass bar</Text>
          <Text style={s.rowSub} numberOfLines={1}>Blur and tint of the bottom bar</Text>
        </View>
        <Text style={s.rowValue}>{g.blur === 0 ? 'Clear' : `Blur ${g.blur}`} · {g.tint}%</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} style={{ marginLeft: 6 }} />
      </Pressable>
      {open && (
        <View style={s.panel} testID={`${testID}-panel`}>
          {stepper('Blur', 'How frosted the glass is', g.blur, 'px', BLUR_RANGE, (v) => setGlass({ blur: v }), 'blur')}
          {stepper('Tint', 'How see-through it is — lower is clearer', g.tint, '%', TINT_RANGE, (v) => setGlass({ tint: v }), 'tint')}
          <Text style={s.hint}>Scroll this page to see the bar change as you adjust it. Saved on this device.</Text>
          {!isDefault && (
            <Pressable onPress={() => setGlass(GLASS_DEFAULT)} style={s.reset} accessibilityRole="button" testID={`${testID}-reset`}>
              <Text style={s.resetText}>Back to default</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  rowSub: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  rowValue: { color: colors.mutedText, fontSize: 13 },
  panel: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, gap: spacing.md,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepLabel: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  stepHint: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  btn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  off: { opacity: 0.35 },
  value: { minWidth: 52, textAlign: 'center', color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  hint: { color: colors.mutedText, fontSize: 12 },
  reset: { alignSelf: 'flex-start' },
  resetText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
