import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet } from '@/src/components/ui';
import { CURRENCIES, symbol } from '@/src/utils/cashLedger';

/** iOS-style list: symbol, name, code, a checkmark on the chosen one, and a
 *  field for any other 3-letter code. */
export function CurrencyPicker({ visible, value, onPick, onClose }: {
  visible: boolean; value: string; onPick: (code: string) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [other, setOther] = useState('');
  const list = CURRENCIES.some((c) => c.code === value) ? CURRENCIES : [{ code: value, name: value }, ...CURRENCIES];
  const otherOk = /^[A-Za-z]{3}$/.test(other.trim());
  return (
    <Sheet visible={visible} onClose={onClose} title="Currency" testID="currency-picker">
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
        <View style={s.group}>
          {list.map((c, i) => (
            <Pressable key={c.code} onPress={() => onPick(c.code)} style={({ pressed }) => [s.row, i > 0 && s.sep, pressed && s.pressed]} testID={`currency-${c.code}`}>
              <Text style={[s.sym, symbol(c.code).length > 2 && s.symLong]} numberOfLines={1}>{symbol(c.code)}</Text>
              <Text style={s.name} numberOfLines={1}>{c.name}</Text>
              <Text style={s.code}>{c.code}</Text>
              <View style={s.check}>{c.code === value && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}</View>
            </Pressable>
          ))}
        </View>
        <Text style={s.foot}>Each currency keeps its own balance — they&apos;re never converted.</Text>
        <View style={[s.group, s.otherRow]}>
          <TextInput value={other} onChangeText={(t) => setOther(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} placeholder="Other code, e.g. JPY"
            placeholderTextColor={colors.mutedText} style={s.otherInput} autoCapitalize="characters" testID="currency-other" />
          <Pressable onPress={() => otherOk && onPick(other.trim().toUpperCase())} disabled={!otherOk} hitSlop={8} testID="currency-other-use">
            <Text style={[s.use, !otherOk && { opacity: 0.4 }]}>Use</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.md, gap: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.surfaceTertiary },
  sym: { width: 40, textAlign: 'center', color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  symLong: { fontSize: 12, color: colors.onSurfaceSecondary },
  name: { flex: 1, color: colors.onSurface, fontSize: 17 },
  code: { color: colors.mutedText, fontSize: 15 },
  check: { width: 22, alignItems: 'flex-end' },
  foot: { color: colors.mutedText, fontSize: 13, marginTop: 8, marginBottom: spacing.md, marginHorizontal: spacing.md },
  otherRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 12, minHeight: 48 },
  otherInput: { flex: 1, color: colors.onSurface, fontSize: 17, paddingVertical: 12, ...({ outlineStyle: 'none' } as any) },
  use: { color: colors.brandPrimary, fontSize: 17, fontWeight: '600' },
});
