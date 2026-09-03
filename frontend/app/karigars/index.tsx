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
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; mobile: string; is_employee: boolean; employee_id: string | null; active: boolean };
type Emp = { id: string; name: string; employee_code: string; designation?: string };

// This screen is for managing karigar *accounts* only (add/edit). Gold/₹ ledger
// lookups live under Reports > Karigar Ledger.
export default function KarigarsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEmployee, setIsEmployee] = useState(true);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [active, setActive] = useState(true);
  const [pickedEmp, setPickedEmp] = useState<Emp | null>(null);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [k, e] = await Promise.all([
        api.get<{ items: Karigar[]; next_cursor: string | null }>('/karigars?limit=50'),
        api.get<Emp[]>('/employees?status=active'),
      ]);
      setKarigars(k.items); setNextCursor(k.next_cursor); setEmployees(e);
    } catch (_e) { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get<{ items: Karigar[]; next_cursor: string | null }>(`/karigars?limit=50&cursor=${nextCursor}`);
      setKarigars((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } catch (_e) { /* keep what's already loaded */ }
    finally { setLoadingMore(false); }
  };

  const resetForm = () => {
    setEditingId(null); setIsEmployee(true); setName(''); setMobile(''); setActive(true);
    setPickedEmp(null); setEmpPickerOpen(false); setShowForm(false);
  };

  const openAdd = () => {
    if (showForm && !editingId) { resetForm(); return; }
    resetForm(); setShowForm(true);
  };

  const openEdit = (k: Karigar) => {
    setEditingId(k.id); setIsEmployee(k.is_employee); setName(k.name); setMobile(k.mobile || ''); setActive(k.active);
    setPickedEmp(k.is_employee ? (employees.find((e) => e.id === k.employee_id) || { id: k.employee_id || '', name: k.name, employee_code: '' }) : null);
    setShowForm(true);
  };

  const save = async () => {
    if (submittingRef.current) return;
    if (isEmployee && !pickedEmp) { notify('Missing', 'Pick which employee is this karigar'); return; }
    if (!isEmployee && !name.trim()) { notify('Missing', 'Enter a name'); return; }
    // Same rule as a ledger account: an outside karigar needs a mobile number
    // (in-house karigars are employees and carry their own contact details).
    if (!isEmployee && mobile.replace(/\D/g, '').length < 7) { notify('Missing', 'A mobile number is required'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const body = {
        name: isEmployee ? (pickedEmp?.name || '') : name.trim(), mobile,
        is_employee: isEmployee, employee_id: isEmployee ? pickedEmp?.id : null, active,
      };
      if (editingId) await api.put(`/karigars/${editingId}`, body);
      else await api.post('/karigars', body);
      resetForm(); await load();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = () => {
    if (!editingId) return;
    confirmAction(
      'Delete karigar?',
      `Remove ${name || 'this karigar'}? Only allowed if their ledger has no entries. This cannot be undone.`,
      'Delete',
      async () => {
        setDeleting(true);
        try { await api.del(`/karigars/${editingId}`); resetForm(); await load(); }
        catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
        finally { setDeleting(false); }
      },
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigars-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Karigars</Text>
        <Pressable onPress={openAdd} style={[styles.iconBtn, styles.addBtn]} testID="new-karigar-btn" hitSlop={12}>
          <Ionicons name={showForm && !editingId ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {showForm && (
            <View style={styles.formCard} testID="karigar-form">
              <View style={styles.formHeaderRow}>
                <Text style={styles.formHeaderText}>{editingId ? 'Edit Karigar' : 'Add Karigar'}</Text>
                <Pressable onPress={resetForm} hitSlop={10} testID="cancel-karigar-form">
                  <Ionicons name="close" size={18} color={colors.mutedText} />
                </Pressable>
              </View>
              <View style={styles.chipRow}>
                <Pressable onPress={() => setIsEmployee(true)} style={[styles.chip, isEmployee && styles.chipActive]} testID="karigar-inhouse">
                  <Text style={[styles.chipText, isEmployee && styles.chipTextActive]}>In-house employee</Text>
                </Pressable>
                <Pressable onPress={() => setIsEmployee(false)} style={[styles.chip, !isEmployee && styles.chipActive]} testID="karigar-outside">
                  <Text style={[styles.chipText, !isEmployee && styles.chipTextActive]}>Outside karigar</Text>
                </Pressable>
              </View>

              {isEmployee ? (
                <>
                  <Text style={styles.label}>Employee</Text>
                  <Pressable onPress={() => setEmpPickerOpen((v) => !v)} style={styles.picker} testID="karigar-emp-toggle">
                    <Text style={pickedEmp ? styles.pickerValue : styles.pickerPlaceholder}>{pickedEmp ? pickedEmp.name : 'Choose an employee'}</Text>
                    <Ionicons name={empPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                  </Pressable>
                  {empPickerOpen && (
                    <View style={styles.pickerList}>
                      {employees.map((e) => (
                        <Pressable key={e.id} onPress={() => { setPickedEmp(e); setEmpPickerOpen(false); }} style={styles.pickerRow} testID={`karigar-emp-${e.id}`}>
                          <Text style={styles.pickerRowName}>{e.name}</Text>
                          <Text style={styles.pickerRowMeta}>{e.designation || e.employee_code}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.label}>Name</Text>
                  <TextInput testID="karigar-name" value={name} onChangeText={setName} placeholder="Karigar or workshop name" placeholderTextColor={colors.mutedText} style={styles.input} />
                </>
              )}
              <Text style={styles.label}>Mobile {isEmployee ? '(optional)' : <Text style={{ color: colors.onError }}>*</Text>}</Text>
              <TextInput testID="karigar-mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="98xxxxxxxx" placeholderTextColor={colors.mutedText} style={styles.input} />

              {editingId && (
                <Pressable onPress={() => setActive((v) => !v)} style={styles.checkRow} testID="karigar-active-toggle">
                  <View style={[styles.checkbox, active && styles.checkboxOn]}>{active && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
                  <Text style={styles.checkLabel}>Active</Text>
                </Pressable>
              )}

              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save} testID="save-karigar-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Add Karigar'}</Text>}
              </Pressable>
              {editingId && (
                <Pressable style={[styles.deleteBtn, deleting && { opacity: 0.6 }]} disabled={deleting} onPress={remove} testID="delete-karigar-btn">
                  {deleting ? <ActivityIndicator color={colors.onError} /> : <Text style={styles.deleteBtnText}>Delete Karigar</Text>}
                </Pressable>
              )}
            </View>
          )}

          {karigars.length === 0 ? (
            <View style={styles.empty}><Ionicons name="hammer-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No karigars yet</Text></View>
          ) : karigars.map((k) => (
            <Pressable key={k.id} onPress={() => openEdit(k)} style={[styles.card, !k.active && { opacity: 0.55 }]} testID={`karigar-${k.id}`}>
              <View style={styles.iconBox}><Ionicons name="hammer-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{k.name}</Text>
                <Text style={styles.cMeta}>{k.is_employee ? 'In-house' : 'Outside'}{k.mobile ? ` · ${k.mobile}` : ''}{!k.active ? ' · Inactive' : ''}</Text>
              </View>
              <Ionicons name="pencil-outline" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
          {!!nextCursor && (
            <Pressable onPress={loadMore} disabled={loadingMore} style={styles.loadMoreBtn} testID="karigars-load-more">
              {loadingMore ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.loadMoreText}>Load more</Text>}
            </Pressable>
          )}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  formHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  deleteBtn: {
    borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.error,
  },
  deleteBtnText: { color: colors.onError, fontWeight: '700', fontSize: 13 },

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
  loadMoreBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, marginTop: spacing.xs,
  },
  loadMoreText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
