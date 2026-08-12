import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Task = {
  id: string; title: string; description: string; priority: 'low' | 'normal' | 'urgent';
  due_date: string | null; status: 'open' | 'done'; assigned_by: string; comments: any[];
};


export default function EmployeeTasksScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setTasks(await api.get<Task[]>('/tasks')); }
    catch (_e) { setTasks([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = tasks.filter((t) => t.status === 'open')
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const done = tasks.filter((t) => t.status === 'done');

  const today = new Date().toISOString().slice(0, 10);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-tasks-screen">
      <View style={styles.header}>
        <Text style={styles.title}>My Tasks</Text>
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.section}>Open · {open.length}</Text>
          {open.length === 0 ? (
            <View style={styles.empty}><Ionicons name="checkmark-done-circle-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>Nothing open — you're all caught up.</Text></View>
          ) : open.map((t) => {
            const overdue = !!t.due_date && t.due_date < today;
            const dotColor = t.priority === 'urgent' ? colors.onError : t.priority === 'normal' ? colors.brandPrimary : colors.mutedText;
            return (
              <Pressable key={t.id} onPress={() => router.push(`/tasks/${t.id}` as any)} style={styles.card} testID={`task-${t.id}`}>
                <View style={[styles.priorityDot, { backgroundColor: dotColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.cardMeta}>
                    {t.assigned_by} {t.due_date ? `· Due ${t.due_date}` : ''} {t.comments?.length ? `· ${t.comments.length} comment${t.comments.length === 1 ? '' : 's'}` : ''}
                  </Text>
                </View>
                {overdue && <View style={styles.overdueBadge}><Text style={styles.overdueText}>Overdue</Text></View>}
                <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
              </Pressable>
            );
          })}

          {done.length > 0 && (
            <>
              <Text style={styles.section}>Done · {done.length}</Text>
              {done.map((t) => (
                <Pressable key={t.id} onPress={() => router.push(`/tasks/${t.id}` as any)} style={[styles.card, styles.cardDone]} testID={`task-${t.id}`}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
                  <Text style={[styles.cardTitle, { flex: 1, marginLeft: spacing.sm }]} numberOfLines={1}>{t.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: '600', fontFamily: fonts.display },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 30, gap: spacing.sm },
  emptyText: { color: colors.mutedText, fontSize: 13 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardDone: { opacity: 0.7 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cardMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  overdueBadge: { backgroundColor: colors.error, borderColor: colors.onError, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  overdueText: { color: colors.onError, fontSize: 10, fontWeight: '700' },
});
