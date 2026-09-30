import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** Shown under a New Customer / New Karigar mobile field when that number is
 * already saved: names who has it, with a one-tap switch to them. */
export function DuplicateMobileNotice({ name, onUse, testID }: { name: string; onUse: () => void; testID?: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={s.box} testID={testID}>
      <Ionicons name="alert-circle" size={16} color={colors.onWarning} />
      <Text style={s.text}>Already saved as <Text style={{ fontWeight: '800' }}>{name}</Text></Text>
      <Pressable onPress={onUse} style={s.btn} testID={testID ? `${testID}-use` : undefined}>
        <Text style={s.btnText}>Use this</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.sm, paddingLeft: spacing.md, marginTop: spacing.sm },
  text: { flex: 1, color: colors.onWarning, fontSize: 13 },
  btn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  btnText: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },
});
