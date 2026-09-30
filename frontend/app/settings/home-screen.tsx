import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';

// Settings › Home screen. The sections switch is per person (saved to their account,
// so it follows them to any device); the alert rules below it apply to everyone's Home.
type Section = { key: string; label: string };
type Rules = Record<string, number | string>;

const RULES: { key: string; label: string; sub: string; unit?: string; time?: boolean }[] = [
  { key: 'not_checked_in_min', label: 'Not checked in', sub: 'Flag staff with no punch this long after shift start', unit: 'min' },
  { key: 'broadcast_deadline', label: 'Rates broadcast by', sub: "Flag today's rates if not sent by this time", time: true },
  { key: 'sample_overdue_days', label: 'Stock out too long', sub: 'A sample with no due date is overdue after', unit: 'days' },
  { key: 'document_pending_days', label: 'Documents pending', sub: 'Pending photos turn amber after', unit: 'days' },
  { key: 'customer_balance_min', label: 'Customer balances from', sub: 'Show customers owing at least', unit: '₹' },
  { key: 'coming_up_days', label: 'Coming up', sub: 'How far ahead to look', unit: 'days' },
  { key: 'payday_day', label: 'Payday', sub: "Day of the month last month's salaries are paid", unit: 'day' },
];

export default function HomeScreenSettings() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [sec, st] = await Promise.all([
      api.get<{ sections: Section[]; hidden: string[] }>('/home/sections').catch(() => null),
      api.get<{ settings: Rules }>('/settings/home').catch(() => null),
    ]);
    if (sec) { setSections(sec.sections); setHidden(new Set(sec.hidden)); } else setSections([]);
    if (st) { setRules(st.settings); setDraft(Object.fromEntries(Object.entries(st.settings).map(([k, v]) => [k, String(v)]))); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (key: string) => {
    const prev = hidden;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHidden(next);
    try { await api.put('/home/sections', { hidden: [...next] }); }
    catch (e: any) { setHidden(prev); toast.error(e?.detail || 'Could not save'); }
  };

  const dirty = !!rules && RULES.some((r) => String(rules[r.key]) !== (draft[r.key] ?? ''));
  const saveRules = async () => {
    const body: Record<string, number | string> = {};
    for (const r of RULES) {
      const v = (draft[r.key] ?? '').trim();
      if (r.time) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { toast.error(`${r.label}: use a time like 11:00`); return; }
        body[r.key] = v;
      } else {
        const n = Number(v);
        if (!v || !Number.isFinite(n) || n < 0) { toast.error(`${r.label}: enter a number`); return; }
        body[r.key] = Math.round(n);
      }
    }
    setSaving(true);
    try {
      const res = await api.put<{ settings: Rules }>('/settings/home', body);
      setRules(res.settings);
      setDraft(Object.fromEntries(Object.entries(res.settings).map(([k, v]) => [k, String(v)])));
      toast.success('Home rules saved');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="home-screen-settings">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Home screen</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Show on Home</Text>
        <Text style={styles.note}>Turn off any part of Home you don&apos;t need. Saved to your account, so it applies on every device you sign in on.</Text>
        {!sections ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 30 }} /> : (
          <View style={styles.card}>
            {sections.map((x, i) => (
              <Pressable key={x.key} onPress={() => toggle(x.key)} style={[styles.row, i > 0 && styles.sep]}
                accessibilityRole="switch" accessibilityState={{ checked: !hidden.has(x.key) }} testID={`home-section-${x.key}`}>
                <Text style={styles.rowLabel}>{x.label}</Text>
                <ToggleSwitch value={!hidden.has(x.key)} />
              </Pressable>
            ))}
          </View>
        )}

        {rules && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Alerts &amp; timing</Text>
            <Text style={styles.note}>When Home flags something under Needs you today. Applies to everyone&apos;s Home. Late check-ins follow each shift&apos;s grace time in Attendance settings.</Text>
            <View style={styles.card}>
              {RULES.map((r, i) => (
                <View key={r.key} style={[styles.row, i > 0 && styles.sep]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowLabel}>{r.label}</Text>
                    <Text style={styles.rowSub}>{r.sub}</Text>
                  </View>
                  {r.unit === '₹' && <Text style={styles.unit}>₹</Text>}
                  <TextInput value={draft[r.key] ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, [r.key]: r.time ? v.replace(/[^0-9:]/g, '') : v.replace(/[^0-9]/g, '') }))}
                    keyboardType={r.time ? 'numbers-and-punctuation' : 'number-pad'} style={[styles.input, r.unit === '₹' && { width: 84 }]} maxLength={r.time ? 5 : 9}
                    testID={`home-rule-${r.key}`} />
                  {!!r.unit && r.unit !== '₹' && <Text style={styles.unit}>{r.unit}</Text>}
                </View>
              ))}
            </View>
            <Pressable onPress={saveRules} disabled={!dirty || saving} style={[styles.save, (!dirty || saving) && { opacity: 0.5 }]} testID="home-rules-save">
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save rules</Text>}
            </Pressable>
          </>
        )}
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
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },
  input: { width: 60, textAlign: 'center', color: colors.onSurface, fontSize: 15, fontWeight: '600', backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 6 },
  unit: { color: colors.mutedText, fontSize: 13, minWidth: 26 },
  save: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
