import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Shift = {
  id: string; name: string; start: string; end: string; grace_min: number;
  late_half_day_after_min?: number | null; remote?: boolean; is_active: boolean;
};

const EMPTY = { name: '', start: '10:00', end: '19:30', grace: '15', lateHalfDay: '' };

export default function ShiftsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Shift[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(EMPTY.name);
  const [start, setStart] = useState(EMPTY.start);
  const [end, setEnd] = useState(EMPTY.end);
  const [grace, setGrace] = useState(EMPTY.grace);
  const [lateHalfDay, setLateHalfDay] = useState(EMPTY.lateHalfDay);
  const [remote, setRemote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Shift[]>('/shifts')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setEditingId(null); setName(EMPTY.name); setStart(EMPTY.start); setEnd(EMPTY.end);
    setGrace(EMPTY.grace); setLateHalfDay(EMPTY.lateHalfDay); setRemote(false);
  };

  const closeForm = () => { resetForm(); setShowForm(false); };

  const startEdit = (s: Shift) => {
    setEditingId(s.id); setName(s.name); setStart(s.start); setEnd(s.end); setGrace(String(s.grace_min));
    setLateHalfDay(s.late_half_day_after_min ? String(s.late_half_day_after_min) : '');
    setRemote(!!s.remote);
    setShowForm(true);
  };

  const submittingRef = useRef(false);
  const save = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { Alert.alert('Missing', 'Shift name is required'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), start, end, grace_min: parseInt(grace || '0', 10),
        late_half_day_after_min: remote || !lateHalfDay.trim() ? null : parseInt(lateHalfDay, 10),
        remote,
        is_active: true,
      };
      if (editingId) await api.put(`/shifts/${editingId}`, payload);
      else await api.post('/shifts', payload);
      closeForm();
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (s: Shift) => {
    confirmAction('Delete shift', `Remove ${s.name}? This cannot be undone.`, 'Delete', async () => {
      setDeletingId(s.id);
      try {
        await api.del(`/shifts/${s.id}`);
        if (editingId === s.id) closeForm();
        await load();
      } catch (e: any) {
        Alert.alert('Failed', e?.detail || 'Could not delete this shift. Please try again.');
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="shifts-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Shifts</Text>
        <Pressable onPress={() => (showForm ? closeForm() : setShowForm(true))} style={[styles.iconBtn, styles.addTopBtn]} testID="show-add-shift-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {!showForm && <Text style={styles.hint}>Define working hours, grace period, and half-day cutoffs for each shift.</Text>}

          {showForm && (
            <View style={styles.formCard} testID="add-shift-form">
              <Text style={styles.section}>{editingId ? 'Edit Shift' : 'Add Shift'}</Text>
              <TextInput testID="shift-name" value={name} onChangeText={setName} placeholder="Shift name" placeholderTextColor={colors.mutedText} style={styles.input} />

              <Pressable onPress={() => setRemote((v) => !v)} style={[styles.remoteRow, remote && styles.remoteRowOn]} testID="shift-remote-toggle">
                <Ionicons name="home-outline" size={18} color={remote ? colors.brandPrimary : colors.mutedText} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.remoteTitle}>Work from home</Text>
                  <Text style={styles.remoteSub}>No attendance. Paid the full set salary each month.</Text>
                </View>
                <View style={[styles.switch, remote && styles.switchOn]}>
                  <View style={[styles.knob, remote && styles.knobOn]} />
                </View>
              </Pressable>

              {!remote && (
                <>
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Start</Text>
                      <TextInput testID="shift-start" value={start} onChangeText={setStart} placeholder="10:00" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>End</Text>
                      <TextInput testID="shift-end" value={end} onChangeText={setEnd} placeholder="19:30" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
                    </View>
                  </View>
                  <Text style={styles.label}>Grace (min)</Text>
                  <TextInput testID="shift-grace" value={grace} onChangeText={(v) => setGrace(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" style={styles.input} />

                  <Text style={styles.label}>Late master — mark half-day if late by (min)</Text>
                  <TextInput
                    testID="shift-late-half-day"
                    value={lateHalfDay}
                    onChangeText={(v) => setLateHalfDay(v.replace(/[^0-9]/g, ''))}
                    keyboardType="numeric"
                    placeholder="Leave blank to disable"
                    placeholderTextColor={colors.mutedText}
                    style={styles.input}
                  />
                  <Text style={styles.hint}>
                    If someone checks in this many minutes past start + grace, that day counts as a half-day for payroll — even if they end up working full hours.
                  </Text>
                </>
              )}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {editingId && (
                  <Pressable style={styles.cancelEditBtn} onPress={resetForm} testID="cancel-edit-shift-btn">
                    <Text style={styles.cancelEditText}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.addBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save} testID="save-shift-btn">
                  {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name={editingId ? 'checkmark' : 'add'} size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.addBtnText}>{editingId ? 'Update Shift' : 'Add Shift'}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <Text style={[styles.section, { marginTop: showForm ? spacing.lg : spacing.sm }]}>Existing Shifts · {items.length}</Text>
          {items.map((s) => (
            <View key={s.id} style={[styles.card, editingId === s.id && styles.cardEditing]} testID={`shift-${s.id}`}>
              <Pressable style={{ flex: 1 }} onPress={() => startEdit(s)} testID={`edit-shift-${s.id}`}>
                <Text style={styles.cName}>{s.name}</Text>
                {s.remote ? (
                  <Text style={styles.cMetaRemote}>Work from home · no attendance · full salary</Text>
                ) : (
                  <>
                    <Text style={styles.cMeta}>{s.start} – {s.end} · Grace {s.grace_min}m</Text>
                    {!!s.late_half_day_after_min && (
                      <Text style={styles.cMetaWarn}>Half-day if late by {s.late_half_day_after_min}m+</Text>
                    )}
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => startEdit(s)} style={styles.editBtn} hitSlop={10} testID={`edit-icon-shift-${s.id}`}>
                <Ionicons name="create-outline" size={16} color={colors.brandSecondary} />
              </Pressable>
              <Pressable onPress={() => remove(s)} style={styles.delBtn} hitSlop={10} disabled={deletingId === s.id} testID={`del-shift-${s.id}`}>
                {deletingId === s.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
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
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4, marginTop: 6 },
  hint: { color: colors.mutedText, fontSize: 11, marginTop: 6, marginBottom: spacing.sm, lineHeight: 15 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  row2: { flexDirection: 'row', gap: spacing.md },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  cancelEditBtn: {
    paddingHorizontal: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  cancelEditText: { color: colors.onSurfaceTertiary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardEditing: { borderColor: colors.brandPrimary },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  cMetaWarn: { color: colors.onWarning, fontSize: 11, marginTop: 2, fontWeight: '600' },
  cMetaRemote: { color: colors.brandSecondary, fontSize: 11.5, marginTop: 2, fontWeight: '600' },
  remoteRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  remoteRowOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  remoteTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  remoteSub: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.brandPrimary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.onSurface, alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.onBrandPrimary },
  editBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    borderColor: colors.brand, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
