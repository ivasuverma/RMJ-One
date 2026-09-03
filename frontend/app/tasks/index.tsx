import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Task = {
  id: string; title: string; priority: 'low' | 'normal' | 'urgent'; due_date: string | null; due_time: string | null;
  status: 'open' | 'done'; assigned_to_name: string; recurring_template_id: string | null;
  points?: number; points_awarded?: number | null; repeat_reminder?: boolean;
};

type TplFreq = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type Template = {
  id: string; title: string; assigned_to_name: string; priority: Task['priority'];
  freq: TplFreq; interval_hours: number | null; active: boolean;
  points: number; max_repetitions: number | null; end_date: string | null; generated_count: number;
};

type Filter = 'open' | 'done' | 'all' | 'recurring';

const FREQ_LABEL: Record<TplFreq, string> = { hourly: 'hrs', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

function repeatsLabel(t: Template) {
  if (t.freq === 'hourly') return `Every ${t.interval_hours || 1}h`;
  return `Every ${FREQ_LABEL[t.freq]}`;
}

function endsLabel(t: Template) {
  if (t.max_repetitions) return `${t.generated_count}/${t.max_repetitions} runs`;
  if (t.end_date) return `until ${t.end_date}`;
  return 'no end';
}

// Recurring templates are managed right here (Recurring tab) instead of on
// their own screen — same list, same "+" button (with repeat pre-toggled),
// so there's one Tasks screen instead of two navigation destinations.
export default function TasksListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async () => {
    try {
      setError('');
      const [t, tpl] = await Promise.all([
        api.get<Task[]>('/tasks'),
        api.get<Template[]>('/tasks/templates').catch(() => []),
      ]);
      setTasks(t); setTemplates(tpl);
    } catch (e: any) { setTasks([]); setError(e?.detail || 'Failed to load tasks'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pause/Resume re-sends the template's full current body (fetched fresh,
  // not the trimmed list-row shape) with just `active` flipped — a partial
  // payload here would silently reset whatever fields this list doesn't
  // carry (see the toggle-active bug fixed for the old recurring.tsx page).
  const toggleTemplateActive = async (tpl: Template) => {
    try {
      const full = await api.get<any>(`/tasks/templates/${tpl.id}`);
      await api.put(`/tasks/templates/${tpl.id}`, { ...full, active: !tpl.active });
      await load();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
  };

  const removeTemplate = (tpl: Template) => {
    confirmAction('Delete recurring task', `Stop repeating "${tpl.title}"? Past instances already created stay as-is.`, 'Delete', async () => {
      try { await api.del(`/tasks/templates/${tpl.id}`); await load(); }
      catch (e: any) { notify('Failed', e?.detail || 'Could not delete this template.'); }
    });
  };

  const today = todayIST();
  const filtered = tasks
    .filter((t) => filter === 'open' ? t.status === 'open' : filter === 'done' ? t.status === 'done' : filter === 'all')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));

  const openCount = tasks.filter((t) => t.status === 'open').length;
  const overdueCount = tasks.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).length;

  const addRoute = filter === 'recurring' ? '/tasks/new?repeat=1' : '/tasks/new';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="tasks-list-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Tasks</Text>
        <Pressable onPress={() => router.push(addRoute as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-task-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryTile}><Text style={styles.summaryValue}>{openCount}</Text><Text style={styles.summaryLabel}>Open</Text></View>
        <View style={styles.summaryTile}><Text style={[styles.summaryValue, overdueCount > 0 && { color: colors.onError }]}>{overdueCount}</Text><Text style={styles.summaryLabel}>Overdue</Text></View>
      </View>

      <View style={styles.segRow}>
        {(['open', 'done', 'all', 'recurring'] as Filter[]).map((f) => (
          <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.segBtn, filter === f && styles.segBtnActive]}>
            <Text style={[styles.segText, filter === f && styles.segTextActive]}>{f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : error && tasks.length === 0 ? (
        <View style={{ padding: spacing.lg }}><ErrorState message={error} onRetry={load} testID="tasks-error" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {filter === 'recurring' ? (
            templates.length === 0 ? (
              <View style={styles.empty}><Ionicons name="repeat-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No recurring tasks yet</Text></View>
            ) : templates.map((t) => (
              <View key={t.id} style={[styles.card, !t.active && { opacity: 0.55 }]} testID={`template-${t.id}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.cardMeta}>{t.assigned_to_name} · {repeatsLabel(t)} · {t.priority}</Text>
                  <Text style={styles.cardMeta}>{endsLabel(t)}{!!t.points && ` · ${t.points}★ on time`}</Text>
                </View>
                <Pressable onPress={() => router.push(`/tasks/new?templateId=${t.id}` as any)} style={styles.smallBtn} testID={`edit-template-${t.id}`}>
                  <Ionicons name="create-outline" size={14} color={colors.onSurfaceSecondary} />
                </Pressable>
                <Pressable onPress={() => toggleTemplateActive(t)} style={styles.smallBtn} testID={`toggle-${t.id}`}>
                  <Text style={styles.smallBtnText}>{t.active ? 'Pause' : 'Resume'}</Text>
                </Pressable>
                <Pressable onPress={() => removeTemplate(t)} style={styles.deleteBtn} testID={`delete-template-${t.id}`}>
                  <Ionicons name="trash-outline" size={16} color={colors.onError} />
                </Pressable>
              </View>
            ))
          ) : filtered.length === 0 ? (
            <View style={styles.empty}><Ionicons name="checkbox-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No {filter === 'all' ? '' : filter} tasks</Text></View>
          ) : filtered.map((t) => {
            const overdue = t.status === 'open' && !!t.due_date && t.due_date < today;
            const dotColor = t.status === 'done' ? colors.onSuccess : t.priority === 'urgent' ? colors.onError : t.priority === 'normal' ? colors.brandPrimary : colors.mutedText;
            return (
              <Pressable key={t.id} onPress={() => router.push(`/tasks/${t.id}` as any)} style={styles.card} testID={`task-row-${t.id}`}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.cardMeta}>
                    {t.assigned_to_name}
                    {t.due_date ? ` · Due ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''}` : ''}
                    {t.recurring_template_id ? ' · Recurring' : ''}
                    {t.repeat_reminder && t.status === 'open' ? ' · Repeats reminder' : ''}
                  </Text>
                </View>
                {!!t.points && (
                  <View style={styles.pointsBadge}>
                    <Ionicons name="star" size={11} color={colors.onWarning} />
                    <Text style={styles.pointsText}>{t.status === 'done' ? (t.points_awarded ?? 0) : t.points}</Text>
                  </View>
                )}
                {overdue && <View style={styles.overdueBadge}><Text style={styles.overdueText}>Overdue</Text></View>}
                <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 22, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 2 },

  segRow: {
    flexDirection: 'row', margin: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontWeight: '600', fontSize: 11 },
  segTextActive: { color: colors.onBrandPrimary },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cardMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  overdueBadge: { backgroundColor: colors.error, borderColor: colors.onError, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  overdueText: { color: colors.onError, fontSize: 10, fontWeight: '700' },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  pointsText: { color: colors.onWarning, fontSize: 11, fontWeight: '700' },

  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  deleteBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.error, borderWidth: 1, borderColor: colors.onError },
});
