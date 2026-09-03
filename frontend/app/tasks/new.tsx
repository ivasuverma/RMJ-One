import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Emp = { id: string; name: string; employee_code: string; designation?: string };
type Priority = 'low' | 'normal' | 'urgent';
type Freq = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type EndCondition = 'repetitions' | 'end_date';

const PRIORITIES: Priority[] = ['low', 'normal', 'urgent'];
const FREQ_OPTIONS: { key: Freq; label: string }[] = [
  { key: 'hourly', label: 'Every X hours' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];
const MAX_REPETITIONS = 120;

// Single "New Task" screen for both a one-off task and a recurring one — the
// "Repeat Task" toggle is what used to be a whole separate screen
// (tasks/recurring.tsx's inline form). Off: posts to /tasks like always. On:
// the due date becomes the recurrence's start date, and the extra
// frequency/end-condition fields below appear, then it posts to
// /tasks/templates instead. Styled after a schedule-transfer pattern (Date
// card, a repeat toggle, a frequency dropdown, and a "No. of repetitions" vs
// "End date" choice) since it maps cleanly onto the same idea.
export default function NewTaskScreen() {
  const router = useRouter();
  const { repeat: repeatParam } = useLocalSearchParams<{ repeat?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [employees, setEmployees] = useState<Emp[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [points, setPoints] = useState('');
  const [repeatReminder, setRepeatReminder] = useState(false);
  const [maxReminders, setMaxReminders] = useState('');
  const [assignedTo, setAssignedTo] = useState<Emp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const [repeat, setRepeat] = useState(repeatParam === '1');
  const [freq, setFreq] = useState<Freq>('daily');
  const [freqPickerOpen, setFreqPickerOpen] = useState(false);
  const [intervalHours, setIntervalHours] = useState('2');
  const [endCondition, setEndCondition] = useState<EndCondition>('repetitions');
  const [maxRepetitions, setMaxRepetitions] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    try { setEmployees(await api.get<Emp[]>('/employees?status=active')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (submittingRef.current) return;
    if (!title.trim()) { Alert.alert('Missing', 'Title is required'); return; }
    if (!assignedTo) { Alert.alert('Missing', 'Pick who this task is for'); return; }

    if (repeat) {
      if (!dueDate) { Alert.alert('Missing', 'Pick a start date for the recurring task'); return; }
      const interval = parseInt(intervalHours, 10) || 0;
      if (freq === 'hourly' && interval < 1) { Alert.alert('Invalid', 'Enter an interval of at least 1 hour'); return; }
      const repetitions = parseInt(maxRepetitions, 10) || 0;
      if (endCondition === 'repetitions' && (repetitions < 1 || repetitions > MAX_REPETITIONS)) {
        Alert.alert('Invalid', `Enter a number of repetitions between 1 and ${MAX_REPETITIONS}`); return;
      }
      if (endCondition === 'end_date' && !endDate) { Alert.alert('Missing', 'Pick an end date, or switch to No. of repetitions'); return; }
      if (endCondition === 'end_date' && endDate < dueDate) { Alert.alert('Invalid', 'End date must be on or after the start date'); return; }

      submittingRef.current = true;
      setSaving(true);
      try {
        await api.post('/tasks/templates', {
          title: title.trim(), description, assigned_to: assignedTo.id, priority, freq,
          start_date: dueDate,
          interval_hours: freq === 'hourly' ? interval : 1,
          due_time: dueTime || null,
          points: parseInt(points, 10) || 0,
          repeat_reminder: repeatReminder,
          max_reminders: repeatReminder && maxReminders ? (parseInt(maxReminders, 10) || null) : null,
          max_repetitions: endCondition === 'repetitions' ? repetitions : null,
          end_date: endCondition === 'end_date' ? endDate : null,
          active: true,
        });
        router.back();
      } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
      finally { setSaving(false); submittingRef.current = false; }
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: title.trim(), description, assigned_to: assignedTo.id, priority, due_date: dueDate || null,
        due_time: dueDate ? (dueTime || null) : null,
        points: parseInt(points, 10) || 0,
        repeat_reminder: repeatReminder,
        max_reminders: repeatReminder && maxReminders ? (parseInt(maxReminders, 10) || null) : null,
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
        <Text style={styles.title}>{repeat ? 'New Recurring Task' : 'Assign Task'}</Text>
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

          {/* Date + Repeat card — mirrors a schedule-transfer form: a date
              field, a repeat toggle, and (when on) a frequency + end-condition
              section. */}
          <View style={styles.card}>
            <Text style={styles.label}>{repeat ? 'Start date' : 'Due date (optional)'}</Text>
            <DateField value={dueDate} onChange={setDueDate} testID="task-due" />

            {!repeat && !!dueDate && (
              <>
                <Text style={styles.label}>Due time (HH:MM)</Text>
                <TextInput
                  testID="task-due-time" value={dueTime}
                  onChangeText={(v) => setDueTime(v.replace(/[^0-9:]/g, ''))}
                  placeholder="18:00" placeholderTextColor={colors.mutedText} style={styles.input}
                />
              </>
            )}

            <Pressable onPress={() => setRepeat((v) => !v)} style={styles.toggleRow} testID="task-repeat-toggle">
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Repeat Task</Text>
                <Text style={styles.toggleSub}>Spawns a fresh copy of this task automatically, on a schedule</Text>
              </View>
              <View style={[styles.switch, repeat && styles.switchOn]}>
                <View style={[styles.switchKnob, repeat && styles.switchKnobOn]} />
              </View>
            </Pressable>

            {repeat && (
              <>
                <Text style={styles.label}>Repeats</Text>
                <Pressable onPress={() => setFreqPickerOpen((v) => !v)} style={styles.picker} testID="freq-picker-toggle">
                  <Text style={styles.pickerValue}>{FREQ_OPTIONS.find((f) => f.key === freq)?.label}</Text>
                  <Ionicons name={freqPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                </Pressable>
                {freqPickerOpen && (
                  <View style={styles.pickerList} testID="freq-picker-list">
                    {FREQ_OPTIONS.map((f) => (
                      <Pressable key={f.key} onPress={() => { setFreq(f.key); setFreqPickerOpen(false); }} style={styles.pickerRow} testID={`freq-opt-${f.key}`}>
                        <Text style={styles.pickerRowName}>{f.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {freq === 'hourly' && (
                  <>
                    <Text style={styles.label}>Every how many hours</Text>
                    <TextInput
                      testID="task-interval-hours" value={intervalHours}
                      onChangeText={(v) => setIntervalHours(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad" placeholder="2" placeholderTextColor={colors.mutedText}
                      style={styles.input}
                    />
                  </>
                )}

                <Text style={styles.label}>Ends</Text>
                <Pressable onPress={() => setEndCondition('repetitions')} style={styles.radioRow} testID="end-cond-repetitions">
                  <View style={[styles.radioCircle, endCondition === 'repetitions' && styles.radioCircleActive]}>
                    {endCondition === 'repetitions' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.radioLabel}>No. of repetitions</Text>
                </Pressable>
                {endCondition === 'repetitions' && (
                  <>
                    <TextInput
                      testID="task-max-repetitions" value={maxRepetitions}
                      onChangeText={(v) => setMaxRepetitions(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad" placeholder="e.g. 12" placeholderTextColor={colors.mutedText}
                      style={styles.input}
                    />
                    <Text style={styles.hintText}>Maximum {MAX_REPETITIONS} repetitions.</Text>
                  </>
                )}

                <Pressable onPress={() => setEndCondition('end_date')} style={[styles.radioRow, { marginTop: spacing.sm }]} testID="end-cond-date">
                  <View style={[styles.radioCircle, endCondition === 'end_date' && styles.radioCircleActive]}>
                    {endCondition === 'end_date' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.radioLabel}>End date</Text>
                </Pressable>
                {endCondition === 'end_date' && <DateField value={endDate} onChange={setEndDate} testID="task-end-date" />}
              </>
            )}
          </View>

          <Text style={styles.label}>Points (optional)</Text>
          <TextInput
            testID="task-points" value={points} onChangeText={(v) => setPoints(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input}
          />
          <View style={styles.hintRow}>
            <Ionicons name="star" size={12} color={colors.onWarning} />
            <Text style={styles.hintText}>Awarded to the employee only if {repeat ? 'each occurrence is' : 'this task is'} completed by its due date/time. Leave 0 for routine tasks with no scoring.</Text>
          </View>

          <Pressable onPress={() => setRepeatReminder((v) => !v)} style={styles.toggleRow} testID="task-repeat-reminder-toggle">
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Remind repeatedly until done</Text>
              <Text style={styles.toggleSub}>Nudges the employee every few hours until marked done, instead of just once</Text>
            </View>
            <View style={[styles.switch, repeatReminder && styles.switchOn]}>
              <View style={[styles.switchKnob, repeatReminder && styles.switchKnobOn]} />
            </View>
          </Pressable>
          {repeatReminder && (
            <>
              <Text style={styles.label}>Max reminders (optional)</Text>
              <TextInput
                testID="task-max-reminders" value={maxReminders} onChangeText={(v) => setMaxReminders(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad" placeholder="Unlimited — reminds until done" placeholderTextColor={colors.mutedText} style={styles.input}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable style={[styles.submit, saving && { opacity: 0.6 }]} disabled={saving} onPress={submit} testID="task-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>{repeat ? 'Create Recurring Task' : 'Assign Task'}</Text>}
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
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 6 },
  hintText: { color: colors.mutedText, fontSize: 11, flex: 1 },

  // Date + Repeat card
  card: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg,
  },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  switch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, padding: 2, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.onSurfaceTertiary },
  switchKnobOn: { backgroundColor: colors.onBrandPrimary, transform: [{ translateX: 18 }] },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioCircleActive: { borderColor: colors.brandPrimary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  radioLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  submit: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
