import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Emp = { id: string; name: string; employee_code: string };
type Priority = 'low' | 'normal' | 'urgent';
type Template = {
  id: string; title: string; description: string; assigned_to: string; assigned_to_name: string;
  priority: Priority; freq: 'daily' | 'weekly' | 'hourly'; weekday: number | null; interval_hours: number | null; active: boolean;
};

const PRIORITIES: Priority[] = ['low', 'normal', 'urgent'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function RecurringTasksScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'hourly'>('daily');
  const [weekday, setWeekday] = useState(0);
  const [intervalHours, setIntervalHours] = useState('2');
  const [assignedTo, setAssignedTo] = useState<Emp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        api.get<Template[]>('/tasks/templates'),
        api.get<Emp[]>('/employees?status=active'),
      ]);
      setTemplates(t); setEmployees(e);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setTitle(''); setDescription(''); setPriority('normal'); setFreq('daily'); setWeekday(0); setIntervalHours('2'); setAssignedTo(null); setShowForm(false); };

  const create = async () => {
    if (submittingRef.current) return;
    if (!title.trim()) { Alert.alert('Missing', 'Title is required'); return; }
    if (!assignedTo) { Alert.alert('Missing', 'Pick who this repeats for'); return; }
    if (freq === 'hourly' && (!parseInt(intervalHours, 10) || parseInt(intervalHours, 10) < 1)) {
      Alert.alert('Invalid', 'Enter an interval of at least 1 hour'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/tasks/templates', {
        title: title.trim(), description, assigned_to: assignedTo.id, priority, freq,
        weekday: freq === 'weekly' ? weekday : null,
        interval_hours: freq === 'hourly' ? (parseInt(intervalHours, 10) || 1) : null,
        active: true,
      });
      resetForm();
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const toggleActive = async (tpl: Template) => {
    try {
      await api.put(`/tasks/templates/${tpl.id}`, {
        title: tpl.title, description: tpl.description, assigned_to: tpl.assigned_to,
        priority: tpl.priority, freq: tpl.freq, weekday: tpl.weekday, interval_hours: tpl.interval_hours, active: !tpl.active,
      });
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
  };

  const remove = (tpl: Template) => {
    confirmAction('Delete recurring task', `Stop repeating "${tpl.title}"? Past instances already created stay as-is.`, 'Delete', async () => {
      try { await api.del(`/tasks/templates/${tpl.id}`); await load(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this template.'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="recurring-tasks-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Recurring Tasks</Text>
        <Pressable onPress={() => setShowForm((v) => !v)} style={[styles.iconBtn, styles.addBtn]} testID="new-template-btn" hitSlop={12}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {showForm && (
            <View style={styles.formCard} testID="template-form">
              <Text style={styles.label}>Assign to</Text>
              <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.picker} testID="template-employee-toggle">
                <Text style={assignedTo ? styles.pickerValue : styles.pickerPlaceholder}>{assignedTo ? assignedTo.name : 'Choose an employee'}</Text>
                <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {pickerOpen && (
                <View style={styles.pickerList}>
                  {employees.map((e) => (
                    <Pressable key={e.id} onPress={() => { setAssignedTo(e); setPickerOpen(false); }} style={styles.pickerRow} testID={`template-emp-${e.id}`}>
                      <Text style={styles.pickerRowName}>{e.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.label}>Title</Text>
              <TextInput testID="template-title" value={title} onChangeText={setTitle} placeholder="e.g. Clean display counters" placeholderTextColor={colors.mutedText} style={styles.input} />

              <Text style={styles.label}>Description (optional)</Text>
              <TextInput testID="template-desc" value={description} onChangeText={setDescription} multiline placeholder="Details..." placeholderTextColor={colors.mutedText} style={styles.textArea} />

              <Text style={styles.label}>Priority</Text>
              <View style={styles.chipRow}>
                {PRIORITIES.map((p) => (
                  <Pressable key={p} onPress={() => setPriority(p)} style={[styles.chip, priority === p && styles.chipActive]} testID={`template-priority-${p}`}>
                    <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p[0].toUpperCase() + p.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Repeats</Text>
              <View style={styles.chipRow}>
                {(['hourly', 'daily', 'weekly'] as const).map((f) => (
                  <Pressable key={f} onPress={() => setFreq(f)} style={[styles.chip, freq === f && styles.chipActive]} testID={`template-freq-${f}`}>
                    <Text style={[styles.chipText, freq === f && styles.chipTextActive]}>{f === 'hourly' ? 'Every X hrs' : f === 'daily' ? 'Every day' : 'Every week'}</Text>
                  </Pressable>
                ))}
              </View>

              {freq === 'hourly' && (
                <>
                  <Text style={styles.label}>Every how many hours</Text>
                  <TextInput
                    testID="template-interval-hours" value={intervalHours}
                    onChangeText={(v) => setIntervalHours(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad" placeholder="2" placeholderTextColor={colors.mutedText}
                    style={styles.input}
                  />
                </>
              )}

              {freq === 'weekly' && (
                <>
                  <Text style={styles.label}>On</Text>
                  <View style={styles.weekRow}>
                    {WEEKDAYS.map((d, i) => (
                      <Pressable key={d} onPress={() => setWeekday(i)} style={[styles.weekChip, weekday === i && styles.chipActive]} testID={`weekday-${i}`}>
                        <Text style={[styles.chipText, weekday === i && styles.chipTextActive]}>{d}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Pressable style={[styles.submit, saving && { opacity: 0.6 }]} disabled={saving} onPress={create} testID="template-save-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Create Recurring Task</Text>}
              </Pressable>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : templates.length === 0 ? (
            <View style={styles.empty}><Ionicons name="repeat-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No recurring tasks yet</Text></View>
          ) : templates.map((t) => (
            <View key={t.id} style={[styles.card, !t.active && { opacity: 0.55 }]} testID={`template-${t.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t.title}</Text>
                <Text style={styles.cardMeta}>
                  {t.assigned_to_name} · {t.freq === 'hourly' ? `Every ${t.interval_hours || 1}h` : t.freq === 'daily' ? 'Every day' : `Every ${WEEKDAYS[t.weekday ?? 0]}`} · {t.priority}
                </Text>
              </View>
              <Pressable onPress={() => toggleActive(t)} style={styles.smallBtn} testID={`toggle-${t.id}`}>
                <Text style={styles.smallBtnText}>{t.active ? 'Pause' : 'Resume'}</Text>
              </Pressable>
              <Pressable onPress={() => remove(t)} style={styles.deleteBtn} testID={`delete-template-${t.id}`}>
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
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  textArea: {
    minHeight: 70, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 200 },
  pickerRow: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  weekRow: { flexDirection: 'row', gap: 6 },
  weekChip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  submit: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  submitText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cardMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  deleteBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.error, borderWidth: 1, borderColor: colors.onError },
});
