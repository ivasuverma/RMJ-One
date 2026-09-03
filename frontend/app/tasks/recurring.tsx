import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Priority = 'low' | 'normal' | 'urgent';
type Freq = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type Template = {
  id: string; title: string; description: string; assigned_to: string; assigned_to_name: string;
  priority: Priority; freq: Freq; start_date: string; interval_hours: number | null; active: boolean;
  points: number; repeat_reminder: boolean; max_repetitions: number | null; end_date: string | null;
  generated_count: number;
};

const FREQ_LABEL: Record<Freq, string> = { hourly: 'hrs', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

function repeatsLabel(t: Template) {
  if (t.freq === 'hourly') return `Every ${t.interval_hours || 1}h`;
  return `Every ${FREQ_LABEL[t.freq]}`;
}

function endsLabel(t: Template) {
  if (t.max_repetitions) return `${t.generated_count}/${t.max_repetitions} runs`;
  if (t.end_date) return `until ${t.end_date}`;
  return 'no end';
}

// Pure management screen now — creating a recurring task happens on the
// same "New Task" screen as a one-off (tasks/new.tsx, "Repeat Task" toggle),
// so this only lists, pauses/resumes, and deletes existing templates.
export default function RecurringTasksScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setTemplates(await api.get<Template[]>('/tasks/templates')); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleActive = async (tpl: Template) => {
    try {
      await api.put(`/tasks/templates/${tpl.id}`, {
        title: tpl.title, description: tpl.description, assigned_to: tpl.assigned_to,
        priority: tpl.priority, freq: tpl.freq, start_date: tpl.start_date, interval_hours: tpl.interval_hours,
        points: tpl.points, repeat_reminder: tpl.repeat_reminder,
        max_repetitions: tpl.max_repetitions, end_date: tpl.end_date, active: !tpl.active,
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
        <Pressable onPress={() => router.push('/tasks/new?repeat=1' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-template-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : templates.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="repeat-outline" size={36} color={colors.mutedText} />
            <Text style={styles.emptyText}>No recurring tasks yet</Text>
            <Pressable onPress={() => router.push('/tasks/new?repeat=1' as any)} style={styles.emptyBtn} testID="empty-new-template-btn">
              <Text style={styles.emptyBtnText}>Create one</Text>
            </Pressable>
          </View>
        ) : templates.map((t) => (
          <View key={t.id} style={[styles.card, !t.active && { opacity: 0.55 }]} testID={`template-${t.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t.title}</Text>
              <Text style={styles.cardMeta}>{t.assigned_to_name} · {repeatsLabel(t)} · {t.priority}</Text>
              <Text style={styles.cardMeta}>{endsLabel(t)}{!!t.points && ` · ${t.points}★ on time`}</Text>
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

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  emptyBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10, marginTop: spacing.sm },
  emptyBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
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
