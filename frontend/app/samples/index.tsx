import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; purity: number;
  gross_weight: number; fine_weight: number; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received'; weight_diff: number | null;
  issued_at: string; received_at: string | null;
};
type Karigar = { id: string; name: string; active: boolean };

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'with_karigar', label: 'With Karigar' },
  { key: 'received', label: 'Received' },
  { key: 'all', label: 'All' },
];

export default function SamplesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canIssue = hasRight('samples', 'edit'); // issuing is the "create/do the job" action, same tier as edit
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [statusTab, setStatusTab] = useState('with_karigar');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [karigarId, setKarigarId] = useState('');
  const [karigarPickerOpen, setKarigarPickerOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [purity, setPurity] = useState('100');
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusTab !== 'all') params.set('status', statusTab);
      if (query.trim()) params.set('q', query.trim());
      const [s, k] = await Promise.all([
        api.get<Sample[]>(`/samples?${params.toString()}`),
        api.get<Karigar[]>('/karigars'),
      ]);
      setSamples(s); setKarigars(k.filter((x) => x.active));
    } catch (_e) { /* ignore */ }
    finally { setRefreshing(false); }
  }, [statusTab, query]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickedKarigar = karigars.find((k) => k.id === karigarId) || null;

  const resetForm = () => {
    setKarigarId(''); setKarigarPickerOpen(false); setDescription('');
    setPurity('100'); setWeight(''); setNote(''); setShowForm(false);
  };

  const issue = async () => {
    if (submittingRef.current) return;
    if (!karigarId) { Alert.alert('Missing', 'Pick which karigar this sample goes to'); return; }
    if (!description.trim()) { Alert.alert('Missing', 'Describe the sample piece'); return; }
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter a weight greater than 0'); return; }
    const p = parseFloat(purity) || 100;
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/samples', {
        karigar_id: karigarId, description: description.trim(), purity: p, gross_weight: w, note: note.trim(),
      });
      resetForm(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="samples-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Sample Issue/Receive</Text>
        {canIssue && (
          <Pressable onPress={() => (showForm ? resetForm() : setShowForm(true))} style={[styles.iconBtn, styles.addBtn]} testID="new-sample-btn" hitSlop={12}>
            <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {showForm && (
            <View style={styles.formCard} testID="sample-form">
              <Text style={styles.formHeaderText}>Issue a Sample</Text>
              <Text style={styles.formHint}>The whole piece goes to the karigar now — expected back at the same weight.</Text>

              <Text style={styles.label}>Karigar</Text>
              <Pressable onPress={() => setKarigarPickerOpen((v) => !v)} style={styles.picker} testID="sample-karigar-toggle">
                <Text style={pickedKarigar ? styles.pickerValue : styles.pickerPlaceholder}>{pickedKarigar ? pickedKarigar.name : 'Choose a karigar'}</Text>
                <Ionicons name={karigarPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {karigarPickerOpen && (
                <View style={styles.pickerList}>
                  {karigars.map((k) => (
                    <Pressable key={k.id} onPress={() => { setKarigarId(k.id); setKarigarPickerOpen(false); }} style={styles.pickerRow} testID={`sample-karigar-${k.id}`}>
                      <Text style={styles.pickerRowName}>{k.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.label}>Description</Text>
              <TextInput testID="sample-description" value={description} onChangeText={setDescription} placeholder="e.g. 22K sample ring design" placeholderTextColor={colors.mutedText} style={styles.input} />

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Weight (g)</Text>
                  <TextInput testID="sample-weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Purity %</Text>
                  <TextInput testID="sample-purity" value={purity} onChangeText={setPurity} keyboardType="decimal-pad" placeholder="100" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
              </View>

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput testID="sample-note" value={note} onChangeText={setNote} placeholder="Anything worth remembering about this sample" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={issue} testID="issue-sample-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Issue Sample</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.tabRow}>
            {STATUS_TABS.map((t) => (
              <Pressable key={t.key} onPress={() => setStatusTab(t.key)} style={[styles.tab, statusTab === t.key && styles.tabActive]} testID={`sample-tab-${t.key}`}>
                <Text style={[styles.tabText, statusTab === t.key && styles.tabTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            testID="samples-search" value={query} onChangeText={setQuery}
            placeholder="Search by tag, description, or karigar" placeholderTextColor={colors.mutedText}
            style={[styles.input, { marginBottom: spacing.md }]}
          />

          {samples.length === 0 ? (
            <View style={styles.empty}><Ionicons name="diamond-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No samples here</Text></View>
          ) : samples.map((s) => (
            <Pressable key={s.id} onPress={() => router.push(`/samples/${s.id}` as any)} style={styles.card} testID={`sample-${s.id}`}>
              <View style={styles.iconBox}><Ionicons name="diamond-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{s.sample_code} · {s.description}</Text>
                <Text style={styles.cMeta}>
                  {s.karigar_name} · {s.gross_weight.toFixed(3)}g
                  {s.status === 'received' && s.weight_diff ? ` · diff ${s.weight_diff > 0 ? '+' : ''}${s.weight_diff.toFixed(3)}g` : ''}
                </Text>
              </View>
              <View style={[styles.badge, s.status === 'received' ? styles.badgeReceived : styles.badgeOut]}>
                <Text style={[styles.badgeText, s.status === 'received' ? styles.badgeTextReceived : styles.badgeTextOut]}>
                  {s.status === 'received' ? 'Received' : 'With Karigar'}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  formHint: { color: colors.mutedText, fontSize: 11, marginTop: 4, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  row2: { flexDirection: 'row', gap: spacing.sm },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },

  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.onBrandPrimary },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm },
  badgeOut: { backgroundColor: colors.brandTertiary },
  badgeReceived: { backgroundColor: colors.success },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOut: { color: colors.brandSecondary },
  badgeTextReceived: { color: colors.onSuccess },
});
