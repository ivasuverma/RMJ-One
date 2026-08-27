import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

// Auto sign-out after inactivity. The owner picks a preset (or Off); every
// signed-in device reads this and arms an idle timer (see AuthContext).
const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Off' },
  { minutes: 5, label: '5 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
];

export default function SecurityScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get<{ auto_signout_minutes: number }>('/settings/security');
      setMinutes(Number(s?.auto_signout_minutes) || 0);
    } catch { setMinutes(0); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (m: number) => {
    setSaving(true);
    const prev = minutes;
    setMinutes(m);
    try {
      await api.put('/settings/security', { auto_signout_minutes: m });
      toast.success(m === 0 ? 'Auto sign-out turned off' : `Sign out after ${PRESETS.find((p) => p.minutes === m)?.label || `${m} min`}`);
    } catch (e: any) {
      setMinutes(prev ?? 0);
      toast.error(e?.detail || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="security-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Security</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.sectionLabel}>Auto sign-out</Text>
        <Text style={styles.note}>Sign everyone out automatically after a stretch with no activity. Applies to every device — admin, accountant and staff.</Text>

        {minutes === null ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.grid}>
            {PRESETS.map((p) => {
              const active = minutes === p.minutes;
              return (
                <Pressable
                  key={p.minutes}
                  onPress={() => !saving && save(p.minutes)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`security-preset-${p.minutes}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={styles.foot}>Tip: a shared shop tablet is safest at 5–15 minutes; a personal phone can be longer.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  sectionLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: spacing.sm },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, minWidth: 74, alignItems: 'center' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary, fontWeight: '700' },
  foot: { color: colors.mutedText, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
});
