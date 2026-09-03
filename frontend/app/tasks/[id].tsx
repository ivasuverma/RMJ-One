import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { todayIST } from '@/src/utils/datetime';
import { DateField } from '@/src/components/DateField';
import { StarPicker } from '@/src/components/StarPicker';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Comment = { id: string; author_name: string; author_role: string; text: string; created_at: string };
type Task = {
  id: string; title: string; description: string; assigned_to: string; assigned_to_name: string;
  assigned_by: string; priority: 'low' | 'normal' | 'urgent'; due_date: string | null; due_time: string | null;
  status: 'open' | 'done'; comments: Comment[]; recurring_template_id: string | null;
  points?: number; points_awarded?: number | null; repeat_reminder?: boolean;
  max_reminders?: number | null; reminder_interval?: 'hourly' | 'daily';
};
type Emp = { id: string; name: string; employee_code: string };

const PRIORITIES: Task['priority'][] = ['low', 'normal', 'urgent'];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isStaff = user?.role !== 'employee';

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [ePriority, setEPriority] = useState<Task['priority']>('normal');
  const [eDue, setEDue] = useState('');
  const [eDueTime, setEDueTime] = useState('');
  const [ePoints, setEPoints] = useState(0);
  const [eRepeatReminder, setERepeatReminder] = useState(false);
  const [eMaxReminders, setEMaxReminders] = useState('');
  const [eReminderInterval, setEReminderInterval] = useState<'hourly' | 'daily'>('hourly');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [employees, setEmployees] = useState<Emp[]>([]);

  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const t = await api.get<Task>(`/tasks/${id}`);
      setTask(t);
      setETitle(t.title); setEDesc(t.description || ''); setEPriority(t.priority); setEDue(t.due_date || '');
      setEDueTime(t.due_time || ''); setEPoints(t.points || 0); setERepeatReminder(!!t.repeat_reminder);
      setEMaxReminders(t.max_reminders ? String(t.max_reminders) : ''); setEReminderInterval(t.reminder_interval || 'hourly');
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not load this task'); router.back(); }
    finally { setLoading(false); }
  }, [id, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markDone = async () => {
    setBusy(true);
    try { await api.post(`/tasks/${id}/complete`); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    setBusy(true);
    try { await api.post(`/tasks/${id}/reopen`); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const remove = () => {
    confirmAction('Delete task', `Delete "${task?.title}"? This cannot be undone.`, 'Delete', async () => {
      try { await api.del(`/tasks/${id}`); router.back(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this task.'); }
    });
  };

  const saveEdit = async () => {
    if (!eTitle.trim()) { Alert.alert('Missing', 'Title is required'); return; }
    setBusy(true);
    try {
      await api.put(`/tasks/${id}`, {
        title: eTitle.trim(), description: eDesc, priority: ePriority, due_date: eDue || null,
        due_time: eDue ? (eDueTime || null) : null, points: ePoints,
        repeat_reminder: eRepeatReminder,
        max_reminders: eRepeatReminder && eMaxReminders ? (parseInt(eMaxReminders, 10) || null) : null,
        reminder_interval: eReminderInterval,
      });
      setEditing(false);
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const openReassign = async () => {
    if (employees.length === 0) {
      try { setEmployees(await api.get<Emp[]>('/employees?status=active')); } catch { /* ignore */ }
    }
    setReassignOpen((v) => !v);
  };

  const reassign = async (emp: Emp) => {
    setBusy(true);
    try { await api.put(`/tasks/${id}`, { assigned_to: emp.id }); setReassignOpen(false); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  const sendComment = async () => {
    if (submittingRef.current || !comment.trim()) return;
    submittingRef.current = true;
    setSendingComment(true);
    try { await api.post(`/tasks/${id}/comments`, { text: comment.trim() }); setComment(''); await load(); }
    catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSendingComment(false); submittingRef.current = false; }
  };

  if (loading || !task) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const canMarkDone = task.status === 'open' && (isStaff || task.assigned_to === user?.id);
  const overdue = !!task.due_date && task.status === 'open' && task.due_date < todayIST();

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="task-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Task</Text>
        {isStaff && !editing && (
          <Pressable onPress={() => setEditing(true)} style={styles.iconBtn} testID="edit-btn" hitSlop={12}>
            <Ionicons name="create-outline" size={20} color={colors.onSurface} />
          </Pressable>
        )}
        {isStaff && editing && <View style={{ width: 40 }} />}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          {editing ? (
            <View>
              <Text style={styles.label}>Title</Text>
              <TextInput testID="edit-title" value={eTitle} onChangeText={setETitle} style={styles.input} />
              <Text style={styles.label}>Description</Text>
              <TextInput testID="edit-desc" value={eDesc} onChangeText={setEDesc} multiline style={styles.textArea} />
              <Text style={styles.label}>Priority</Text>
              <View style={styles.chipRow}>
                {PRIORITIES.map((p) => (
                  <Pressable key={p} onPress={() => setEPriority(p)} style={[styles.chip, ePriority === p && styles.chipActive]} testID={`edit-priority-${p}`}>
                    <Text style={[styles.chipText, ePriority === p && styles.chipTextActive]}>{p[0].toUpperCase() + p.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <DateField label="Due date (optional)" value={eDue} onChange={setEDue} testID="edit-due" />
                </View>
                {!!eDue && (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Due time</Text>
                    <TextInput testID="edit-due-time" value={eDueTime} onChangeText={(v) => setEDueTime(v.replace(/[^0-9:]/g, ''))} placeholder="18:00" placeholderTextColor={colors.mutedText} style={styles.input} />
                  </View>
                )}
              </View>

              <Text style={styles.label}>Stars (optional)</Text>
              <StarPicker value={ePoints} onChange={setEPoints} testID="edit-stars" />

              <Pressable onPress={() => setERepeatReminder((v) => !v)} style={styles.toggleRow} testID="edit-repeat-reminder-toggle">
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Repeat reminder until done</Text>
                  <Text style={styles.toggleSub}>Nudges the employee until marked done</Text>
                </View>
                <View style={[styles.switch, eRepeatReminder && styles.switchOn]}>
                  <View style={[styles.switchKnob, eRepeatReminder && styles.switchKnobOn]} />
                </View>
              </Pressable>
              {eRepeatReminder && (
                <>
                  <Text style={styles.label}>Remind</Text>
                  <View style={styles.chipRow}>
                    {(['hourly', 'daily'] as const).map((iv) => (
                      <Pressable key={iv} onPress={() => setEReminderInterval(iv)} style={[styles.chip, eReminderInterval === iv && styles.chipActive]} testID={`edit-reminder-interval-${iv}`}>
                        <Text style={[styles.chipText, eReminderInterval === iv && styles.chipTextActive]}>{iv === 'hourly' ? 'Hourly' : 'Daily'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Max reminders (optional)</Text>
                  <TextInput
                    testID="edit-max-reminders" value={eMaxReminders} onChangeText={(v) => setEMaxReminders(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad" placeholder="Unlimited — reminds until done" placeholderTextColor={colors.mutedText} style={styles.input}
                  />
                </>
              )}

              <View style={styles.editActions}>
                <Pressable onPress={() => { setEditing(false); load(); }} style={styles.cancelBtn} testID="edit-cancel"><Text style={styles.cancelBtnText}>Cancel</Text></Pressable>
                <Pressable onPress={saveEdit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="edit-save">
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{task.title}</Text>
                <View style={[styles.statusBadge, task.status === 'done' ? styles.statusDone : overdue ? styles.statusOverdue : styles.statusOpen]}>
                  <Text style={styles.statusText}>{task.status === 'done' ? 'Done' : overdue ? 'Overdue' : 'Open'}</Text>
                </View>
              </View>
              {!!task.description && <Text style={styles.description}>{task.description}</Text>}

              <View style={styles.metaCard}>
                <MetaRow icon="flag-outline" label="Priority" value={task.priority[0].toUpperCase() + task.priority.slice(1)} />
                <MetaRow icon="calendar-outline" label="Due date" value={task.due_date ? `${task.due_date}${task.due_time ? ` ${task.due_time}` : ''}` : 'No due date'} />
                <Pressable disabled={!isStaff} onPress={openReassign} testID="reassign-toggle">
                  <MetaRow icon="person-outline" label="Assigned to" value={task.assigned_to_name} trailing={isStaff ? 'chevron-down' : undefined} />
                </Pressable>
                <MetaRow icon="person-add-outline" label="Assigned by" value={task.assigned_by} />
                {!!task.points && (
                  <MetaRow
                    icon="star-outline" label="Points"
                    value={task.status === 'done' ? `${task.points_awarded ?? 0} of ${task.points} earned` : `${task.points} on time`}
                  />
                )}
                {task.repeat_reminder && task.status === 'open' && <MetaRow icon="notifications-outline" label="Reminders" value="Repeating until done" />}
                {task.recurring_template_id && <MetaRow icon="repeat-outline" label="Source" value="Recurring task" />}
              </View>

              {reassignOpen && (
                <View style={styles.reassignList} testID="reassign-list">
                  {employees.length === 0 ? <ActivityIndicator color={colors.brandPrimary} /> : employees.map((e) => (
                    <Pressable key={e.id} onPress={() => reassign(e)} style={styles.reassignRow} testID={`reassign-${e.id}`}>
                      <Text style={styles.reassignName}>{e.name}</Text>
                      <Text style={styles.reassignCode}>{e.employee_code}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <RecordPhotos refType="task" refId={task.id} label="Photos" />

              <View style={styles.actionsRow}>
                {canMarkDone && (
                  <Pressable onPress={markDone} disabled={busy} style={[styles.actionBtn, styles.actionBtnPrimary]} testID="mark-done-btn">
                    {busy ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} /><Text style={styles.actionBtnPrimaryText}>Mark Done</Text></>}
                  </Pressable>
                )}
                {isStaff && task.status === 'done' && (
                  <Pressable onPress={reopen} disabled={busy} style={styles.actionBtn} testID="reopen-btn">
                    <Ionicons name="refresh" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Reopen</Text>
                  </Pressable>
                )}
                {isStaff && (
                  <Pressable onPress={remove} style={[styles.actionBtn, styles.actionBtnDanger]} testID="delete-btn">
                    <Ionicons name="trash-outline" size={16} color={colors.onError} /><Text style={styles.actionBtnDangerText}>Delete</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.section}>Comments · {task.comments.length}</Text>
              {task.comments.length === 0 ? (
                <Text style={styles.noComments}>No comments yet.</Text>
              ) : task.comments.map((c) => (
                <View key={c.id} style={styles.commentRow} testID={`comment-${c.id}`}>
                  <View style={styles.commentAvatar}><Text style={styles.commentAvatarText}>{c.author_name[0]?.toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commentAuthor}>{c.author_name}</Text>
                    <Text style={styles.commentText}>{c.text}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {!editing && (
        <View style={styles.commentBar}>
          <TextInput
            testID="comment-input"
            value={comment} onChangeText={setComment} placeholder="Add a comment..."
            placeholderTextColor={colors.mutedText} style={styles.commentInput}
          />
          <Pressable onPress={sendComment} disabled={sendingComment || !comment.trim()} style={[styles.sendBtn, (!comment.trim() || sendingComment) && { opacity: 0.5 }]} testID="comment-send-btn">
            {sendingComment ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="send" size={16} color={colors.onBrandPrimary} />}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function MetaRow({ icon, label, value, trailing }: { icon: any; label: string; value: string; trailing?: any }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color={colors.brandSecondary} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
      {trailing && <Ionicons name={trailing} size={14} color={colors.mutedText} />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  title: { flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '700', fontFamily: fonts.display },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  statusDone: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  statusOverdue: { backgroundColor: colors.error, borderColor: colors.onError },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.onSurface },
  description: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },

  metaCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md, overflow: 'hidden',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  metaLabel: { color: colors.mutedText, fontSize: 12, width: 90 },
  metaValue: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600', textAlign: 'right', marginRight: spacing.xs },

  reassignList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, padding: spacing.sm, maxHeight: 240 },
  reassignRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.sm },
  reassignName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  reassignCode: { color: colors.mutedText, fontSize: 12 },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  actionBtnPrimaryText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  actionBtnDanger: { borderColor: colors.error },
  actionBtnDangerText: { color: colors.onError, fontSize: 13, fontWeight: '700' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  noComments: { color: colors.mutedText, fontSize: 13 },
  commentRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  commentAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700' },
  commentAuthor: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },
  commentText: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  textArea: {
    minHeight: 80, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, color: colors.onSurface, textAlignVertical: 'top', fontSize: 14,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginTop: spacing.md,
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
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700' },
  saveBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },

  commentBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  commentInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
});
