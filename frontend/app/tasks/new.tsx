import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Emp = { id: string; name: string; employee_code: string; designation?: string };
type Priority = 'low' | 'normal' | 'urgent';
const PRIORITIES: Priority[] = ['low', 'normal', 'urgent'];

export default function NewTaskScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [employees, setEmployees] = useState<Emp[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<Emp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try { setEmployees(await api.get<Emp[]>('/employees?status=active')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (submittingRef.current) return;
    if (!title.trim()) { Alert.alert('Missing', 'Title is required'); return; }
    if (!assignedTo) { Alert.alert('Missing', 'Pick who this task is for'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: title.trim(), description, assigned_to: assignedTo.id, priority, due_date: dueDate || null,
      });
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="task-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Assign Task</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Assign to</Text>
          <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.picker} testID="employee-picker-toggle">
            <Text style={assignedTo ? styles.pickerValue : styles.pickerPlaceholder}>{assignedTo ? assignedTo.name : 'Choose an employee'}</Text>
            <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
          </Pressable>
          {pickerOpen && (
            <View style={styles.pickerList} testID="employee-picker-list">
              {employees.map((e) => (
                <Pressable key={e.id} onPress={() => { setAssignedTo(e); setPickerOpen(false); }} style={styles.pickerRow} testID={`emp-opt-${e.id}`}>
                  <Text style={styles.pickerRowName}>{e.name}</Text>
                  <Text style={styles.pickerRowMeta}>{e.designation || e.employee_code}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.label}>Title</Text>
          <TextInput testID="task-title" value={title} onChangeText={setTitle} placeholder="e.g. Clean display counters" placeholderTextColor={colors.mutedText} style={styles.input} />

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput testID="task-desc" value={description} onChangeText={setDescription} multiline placeholder="Details or instructions..." placeholderTextColor={colors.mutedText} style={styles.textArea} />

          <Text style={styles.label}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipActive]} testID={`priority-${p}`}>
                <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p[0].toUpperCase() + p.slice(1)}</Text>
              </Pressable>
            ))}
          </View>

          <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} testID="task-due" />

          <View style={styles.info}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>For a task that repeats every day or every week, use the recurring templates screen instead (the repeat icon on Tasks).</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable style={[styles.submit, saving && { opacity: 0.6 }]} disabled={saving} onPress={submit} testID="task-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Assign Task</Text>}
        </Pressable>
      </View>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15,
  },
  textArea: {
    minHeight: 90, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  pickerValue: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 15 },
  pickerList: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.sm, maxHeight: 260, padding: spacing.xs,
  },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  info: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.lg,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  submit: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
