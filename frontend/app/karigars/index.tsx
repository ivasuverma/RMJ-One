import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; mobile: string; is_employee: boolean; employee_id: string | null; active: boolean };
type Emp = { id: string; name: string; employee_code: string; designation?: string };

export default function KarigarsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isEmployee, setIsEmployee] = useState(true);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pickedEmp, setPickedEmp] = useState<Emp | null>(null);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [k, e] = await Promise.all([api.get<Karigar[]>('/karigars'), api.get<Emp[]>('/employees?status=active')]);
      setKarigars(k); setEmployees(e);
    } catch (_e) { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (submittingRef.current) return;
    if (isEmployee && !pickedEmp) { Alert.alert('Missing', 'Pick which employee is this karigar'); return; }
    if (!isEmployee && !name.trim()) { Alert.alert('Missing', 'Enter a name'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/karigars', {
        name: isEmployee ? (pickedEmp?.name || '') : name.trim(), mobile,
        is_employee: isEmployee, employee_id: isEmployee ? pickedEmp?.id : null, active: true,
      });
      setName(''); setMobile(''); setPickedEmp(null); setShowForm(false); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigars-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Karigars</Text>
        <Pressable onPress={() => setShowForm((v) => !v)} style={[styles.iconBtn, styles.addBtn]} testID="new-karigar-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {showForm && (
            <View style={styles.formCard} testID="karigar-form">
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
              <Text style={styles.label}>Mobile (optional)</Text>
              <TextInput testID="karigar-mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="98xxxxxxxx" placeholderTextColor={colors.mutedText} style={styles.input} />

              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="save-karigar-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Add Karigar</Text>}
              </Pressable>
            </View>
          )}

          {karigars.length === 0 ? (
            <View style={styles.empty}><Ionicons name="hammer-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No karigars yet</Text></View>
          ) : karigars.map((k) => (
            <Pressable key={k.id} onPress={() => router.push(`/karigars/${k.id}` as any)} style={styles.card} testID={`karigar-${k.id}`}>
              <View style={styles.iconBox}><Ionicons name="hammer-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{k.name}</Text>
                <Text style={styles.cMeta}>{k.is_employee ? 'In-house' : 'Outside'}{k.mobile ? ` · ${k.mobile}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
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
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },

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
});
