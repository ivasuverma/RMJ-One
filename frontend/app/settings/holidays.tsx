import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { displayDateOnly } from '@/src/utils/datetime';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type H = { id: string; date: string; name: string; type: 'public' | 'festival' | 'store_closed' };

const TYPES: H['type'][] = ['public', 'festival', 'store_closed'];

const fmtDate = (s: string) => displayDateOnly(s);

export default function HolidaysScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<H[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<H['type']>('public');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<H[]>('/holidays')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name.trim()) {
      notify('Missing', 'Enter date (YYYY-MM-DD) and holiday name'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/holidays', { date, name: name.trim(), type });
      setDate(''); setName(''); setType('public'); setShowForm(false); await load();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (h: H) => {
    confirmAction('Delete holiday', `Remove ${h.name}?`, 'Delete', async () => {
      try { await api.del(`/holidays/${h.id}`); await load(); }
      catch (e: any) { notify('Failed', e?.detail || 'Could not delete this holiday. Please try again.'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="holidays-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Holidays</Text>
        <Pressable onPress={() => setShowForm((v) => !v)} style={[styles.iconBtn, styles.addTopBtn]} testID="show-add-hol-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {!showForm && <Text style={styles.hint}>Mark public holidays, festivals, and store closures so attendance and payroll account for them.</Text>}

          {showForm && (
            <View style={styles.formCard} testID="add-hol-form">
              <Text style={styles.section}>Add Holiday</Text>
              <DateField label="Date" value={date} onChange={setDate} testID="hol-date" />
              <Text style={styles.label}>Name</Text>
              <TextInput testID="hol-name" value={name} onChangeText={setName} placeholder="Independence Day" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {TYPES.map((t) => (
                  <Pressable key={t} testID={`hol-type-${t}`} onPress={() => setType(t)} style={[styles.typeBtn, type === t && styles.typeBtnActive]}>
                    <Text style={[styles.typeText, type === t && styles.typeTextActive]}>{t.replace('_', ' ').toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="add-hol-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>Add Holiday</Text></>}
              </Pressable>
            </View>
          )}

          <Text style={[styles.section, { marginTop: showForm ? spacing.lg : spacing.sm }]}>Upcoming · {items.length}</Text>
          {items.map((h) => (
            <View key={h.id} style={styles.card} testID={`hol-${h.id}`}>
              <View style={styles.iconBox}><Ionicons name="calendar-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{h.name}</Text>
                <Text style={styles.cMeta}>{fmtDate(h.date)} · {h.type.replace('_', ' ').toUpperCase()}</Text>
              </View>
              <Pressable onPress={() => remove(h)} style={styles.delBtn} hitSlop={10} testID={`del-hol-${h.id}`}>
                <Ionicons name="trash-outline" size={16} color={colors.onError} />
              </Pressable>
            </View>
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
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  addTopBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4, marginTop: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  typeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  typeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeText: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: '700' },
  typeTextActive: { color: colors.onBrandPrimary },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
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
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
