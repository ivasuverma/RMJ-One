import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Shift = { id: string; name: string; start: string; end: string };

type EmployeeForm = {
  name: string; employee_code: string; biometric_id: string; department: string; designation: string;
  shift: string; salary: string; joining_date: string; mobile: string; address: string;
  aadhaar: string; pan: string; bank_account: string; bank_ifsc: string; bank_name: string;
  status: 'active' | 'inactive' | 'on_leave'; notes: string;
};

const EMPTY: EmployeeForm = {
  name: '', employee_code: '', biometric_id: '', department: '', designation: '', shift: 'General', salary: '',
  joining_date: new Date().toISOString().slice(0, 10), mobile: '', address: '',
  aadhaar: '', pan: '', bank_account: '', bank_ifsc: '', bank_name: '', status: 'active', notes: '',
};

const STATUSES: EmployeeForm['status'][] = ['active', 'on_leave', 'inactive'];

export default function EmployeeForm() {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id?: string; edit?: string }>();
  // Route can be /employee/new or /employee/edit/[id] — see edit route
  const id = params.id;
  const isEdit = !!id;

  const [form, setForm] = useState<EmployeeForm>(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shifts, setShifts] = useState<Shift[]>([]);
  const submittingRef = useRef(false);

  useEffect(() => {
    api.get<Shift[]>('/shifts').then(setShifts).catch(() => setShifts([]));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await api.get<{ employee: any }>(`/employees/${id}`);
        const e = res.employee;
        setForm({
          name: e.name || '', employee_code: e.employee_code || '', biometric_id: e.biometric_id || '', department: e.department || '',
          designation: e.designation || '', shift: e.shift || 'General',
          salary: String(e.salary ?? ''), joining_date: e.joining_date || '',
          mobile: e.mobile || '', address: e.address || '', aadhaar: e.aadhaar || '',
          pan: e.pan || '', bank_account: e.bank_account || '', bank_ifsc: e.bank_ifsc || '',
          bank_name: e.bank_name || '', status: e.status || 'active', notes: e.notes || '',
        });
      } catch (_e) {
        Alert.alert('Failed to load employee');
      } finally { setLoading(false); }
    })();
  }, [id, isEdit]);

  const setField = <K extends keyof EmployeeForm>(k: K, v: EmployeeForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.salary && isNaN(Number(form.salary))) e.salary = 'Must be a number';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSave = async () => {
    if (submittingRef.current) return;
    if (!validate()) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        salary: form.salary ? Number(form.salary) : 0,
      };
      if (isEdit) await api.put(`/employees/${id}`, payload);
      else await api.post('/employees', payload);
      router.back();
    } catch (e: any) {
      Alert.alert('Save failed', e?.detail || 'Please try again');
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="employee-form-screen">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="form-back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{isEdit ? 'Edit Employee' : 'Add Employee'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <SectionTitle text="Personal" />
          <Field label="Full Name *" value={form.name} onChangeText={(v) => setField('name', v)} error={errors.name} testID="field-name" />
          <Field label="Mobile" value={form.mobile} onChangeText={(v) => setField('mobile', v)} keyboardType="phone-pad" testID="field-mobile" />
          <Field label="Address" value={form.address} onChangeText={(v) => setField('address', v)} multiline testID="field-address" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Aadhaar" value={form.aadhaar} onChangeText={(v) => setField('aadhaar', v)} testID="field-aadhaar" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="PAN" value={form.pan} onChangeText={(v) => setField('pan', v.toUpperCase())} autoCapitalize="characters" testID="field-pan" />
            </View>
          </View>

          <SectionTitle text="Job" />
          <Field label="Employee Code" value={form.employee_code} onChangeText={(v) => setField('employee_code', v.toUpperCase())} placeholder="Auto if blank" autoCapitalize="characters" testID="field-code" />
          <Field label="Biometric Device ID" value={form.biometric_id} onChangeText={(v) => setField('biometric_id', v)} placeholder="Only if it differs from the code above, e.g. 1" testID="field-biometric-id" />

          <Text style={styles.label}>Shift</Text>
          {shifts.length === 0 ? (
            <Pressable onPress={() => router.push('/settings/shifts')} style={styles.noShifts} testID="no-shifts-link">
              <Ionicons name="add-circle-outline" size={16} color={colors.brandSecondary} />
              <Text style={styles.noShiftsText}>No shifts set up yet — tap to add one</Text>
            </Pressable>
          ) : (
            <View style={styles.statusRow}>
              {shifts.map((s) => (
                <Pressable
                  key={s.id}
                  testID={`shift-opt-${s.id}`}
                  onPress={() => setField('shift', s.name)}
                  style={[styles.statusOpt, form.shift === s.name && styles.statusOptActive]}
                >
                  <Text style={[styles.statusOptText, form.shift === s.name && styles.statusOptTextActive]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[styles.shiftOptSub, form.shift === s.name && styles.shiftOptSubActive]}>
                    {s.start}–{s.end}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Department" value={form.department} onChangeText={(v) => setField('department', v)} testID="field-department" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Designation" value={form.designation} onChangeText={(v) => setField('designation', v)} testID="field-designation" />
            </View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Salary (₹/mo)" value={form.salary} onChangeText={(v) => setField('salary', v.replace(/[^0-9.]/g, ''))} keyboardType="numeric" error={errors.salary} testID="field-salary" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Joining Date" value={form.joining_date} onChangeText={(v) => setField('joining_date', v)} placeholder="YYYY-MM-DD" testID="field-joining" />
            </View>
          </View>

          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            {STATUSES.map((s) => (
              <Pressable
                key={s}
                testID={`status-${s}`}
                onPress={() => setField('status', s)}
                style={[styles.statusOpt, form.status === s && styles.statusOptActive]}
              >
                <Text style={[styles.statusOptText, form.status === s && styles.statusOptTextActive]}>
                  {s === 'on_leave' ? 'On Leave' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <SectionTitle text="Bank" />
          <Field label="Bank Name" value={form.bank_name} onChangeText={(v) => setField('bank_name', v)} testID="field-bank-name" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Field label="Account No." value={form.bank_account} onChangeText={(v) => setField('bank_account', v)} keyboardType="numeric" testID="field-bank-acct" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="IFSC" value={form.bank_ifsc} onChangeText={(v) => setField('bank_ifsc', v.toUpperCase())} autoCapitalize="characters" testID="field-bank-ifsc" />
            </View>
          </View>

          <SectionTitle text="Notes" />
          <Field label="Additional notes" value={form.notes} onChangeText={(v) => setField('notes', v)} multiline testID="field-notes" />

          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky save */}
      <LinearGradient
        colors={scheme === 'light' ? ['rgba(247,241,230,0)', 'rgba(247,241,230,0.95)'] : ['rgba(13,13,13,0)', 'rgba(13,13,13,0.95)']}
        style={[styles.saveBarBg, { pointerEvents: 'none' as const }]}
      />
      <View style={styles.saveBar}>
        <Pressable
          testID="form-save-btn"
          onPress={onSave}
          disabled={saving}
          style={({ pressed }) => [styles.saveBtn, saving && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.99 }] }]}
        >
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{isEdit ? 'Update Employee' : 'Save Employee'}</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SectionTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.section}>{text}</Text>;
}

function Field({
  label, value, onChangeText, keyboardType, multiline, autoCapitalize, placeholder, error, testID,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  keyboardType?: any; multiline?: boolean; autoCapitalize?: any; placeholder?: string; error?: string; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        style={[styles.input, multiline && { height: 80, textAlignVertical: 'top' }, !!error && styles.inputErr]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
      />
      {!!error && <Text style={styles.errText}>{error}</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },

  headerBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  headerTitle: {
    flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600',
    fontFamily: fonts.display,
  },

  scroll: { padding: spacing.lg },
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  inputErr: { borderColor: colors.onError },
  errText: { color: colors.onError, fontSize: 12, marginTop: 4 },
  row2: { flexDirection: 'row', gap: spacing.md },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statusOpt: {
    flexGrow: 1, minWidth: 100, paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  statusOptActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  statusOptText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: '600' },
  statusOptTextActive: { color: colors.onBrandPrimary },
  shiftOptSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  shiftOptSubActive: { color: colors.onBrandPrimary, opacity: 0.85 },
  noShifts: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  noShiftsText: { color: colors.brandSecondary, fontSize: 13 },

  saveBarBg: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingBottom: spacing.xl },
  saveBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15, letterSpacing: 0.4 },
});
