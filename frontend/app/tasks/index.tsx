import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Task = {
  id: string; title: string; priority: 'low' | 'normal' | 'urgent'; due_date: string | null;
  status: 'open' | 'done'; assigned_to_name: string; recurring_template_id: string | null;
};

type Filter = 'open' | 'done' | 'all';

export default function TasksListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async () => {
    try { setTasks(await api.get<Task[]>('/tasks')); }
    catch (_e) { setTasks([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = new Date().toISOString().slice(0, 10);
  const filtered = tasks
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));

  const openCount = tasks.filter((t) => t.status === 'open').length;
  const overdueCount = tasks.filter((t) => t.status === 'open' && t.due_date && t.due_date < today).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="tasks-list-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Tasks</Text>
        <Pressable onPress={() => router.push('/tasks/recurring' as any)} style={styles.iconBtn} testID="recurring-btn" hitSlop={12}>
          <Ionicons name="repeat-outline" size={20} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push('/tasks/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-task-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryTile}><Text style={styles.summaryValue}>{openCount}</Text><Text style={styles.summaryLabel}>Open</Text></View>
        <View style={styles.summaryTile}><Text style={[styles.summaryValue, overdueCount > 0 && { color: colors.onError }]}>{overdueCount}</Text><Text style={styles.summaryLabel}>Overdue</Text></View>
      </View>

      <View style={styles.segRow}>
        {(['open', 'done', 'all'] as Filter[]).map((f) => (
          <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.segBtn, filter === f && styles.segBtnActive]}>
            <Text style={[styles.segText, filter === f && styles.segTextActive]}>{f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {filtered.length === 0 ? (
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
                    {t.assigned_to_name}{t.due_date ? ` · Due ${t.due_date}` : ''}{t.recurring_template_id ? ' · Recurring' : ''}
                  </Text>
                </View>
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
});
