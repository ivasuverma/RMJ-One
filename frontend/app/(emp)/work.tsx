import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';
import { AppSetupBanner } from '@/src/components/AppSetupBanner';
import { TabBarSpacer } from '@/src/components/GlassTabBar';
import { StickyHeader, useScrolled } from '@/src/components/ui/StickyHeader';

// Employee Work hub — same card language as the admin Work board: an
// "In progress" list of process rows (each showing its live state before you
// tap), then the granted-module and personal shortcuts underneath. Rows are
// gated on the modules this employee has actually been granted; My Tasks and
// My Ledger are always present so the tab is never a dead end.
type RepairDash = { received: number; with_karigar: number; ready: number; pending_delivery: number; overdue: number; delivered_today: number };
type SampleDash = { with_karigar: number; overdue: number; received_today: number };
type Task = { id: string; title: string; due_date?: string };

type Seg = { text: string; tone?: 'hot' | 'bad' | 'strong' };
type Row = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; segs: Seg[]; badge?: number; route: string };

export default function EmployeeWorkScreen() {
  const { scrolled, onScroll } = useScrolled();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [repairDash, setRepairDash] = useState<RepairDash | null>(null);
  const [sampleDash, setSampleDash] = useState<SampleDash | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [docPending, setDocPending] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasRepairs = hasModule('repairs');
  const hasSamples = hasModule('samples');
  const hasDocs = hasModule('documents');

  const load = useCallback(async () => {
    await Promise.allSettled([
      hasRepairs ? api.get<RepairDash>('/repairs/dashboard').then(setRepairDash).catch(() => setRepairDash(null)) : Promise.resolve(),
      hasSamples ? api.get<SampleDash>('/samples/dashboard').then(setSampleDash).catch(() => setSampleDash(null)) : Promise.resolve(),
      hasDocs ? api.get<{ pending_count: number }>('/documents/summary').then((s) => setDocPending(s.pending_count)).catch(() => {}) : Promise.resolve(),
      api.get<Task[]>('/tasks?status=open').then(setTasks).catch(() => setTasks([])),
    ]);
    setRefreshing(false);
  }, [hasRepairs, hasSamples, hasDocs]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const today = todayIST();
  const tasksDue = tasks.filter((t) => t.due_date && t.due_date === today).length;
  const tasksOverdue = tasks.filter((t) => t.due_date && t.due_date < today).length;

  const go = (route: string) => router.push(route as any);

  // In-progress process rows (pipeline-style), each gated on access + live data.
  const rows: Row[] = [];
  if (hasRepairs && repairDash) {
    rows.push({
      key: 'repairs', title: 'Repairs', icon: 'construct-outline', route: '/repairs',
      badge: repairDash.ready || undefined,
      segs: [
        { text: `${repairDash.with_karigar} with karigar`, tone: 'hot' },
        { text: ' · ' }, { text: `${repairDash.overdue} overdue`, tone: 'bad' },
        { text: ' · ' }, { text: `${repairDash.ready} to bill` },
      ],
    });
  }
  if (hasSamples && sampleDash) {
    rows.push({
      key: 'stock', title: 'Stock In / Out', icon: 'diamond-outline', route: '/samples',
      segs: [
        { text: `${sampleDash.with_karigar} samples out` },
        ...(sampleDash.overdue > 0 ? [{ text: ' · ' }, { text: `${sampleDash.overdue} overdue`, tone: 'bad' as const }] : []),
      ],
    });
  }
  rows.push({
    key: 'tasks', title: 'My Tasks', icon: 'checkbox-outline', route: '/(emp)/tasks',
    badge: tasksDue || undefined,
    segs: tasks.length === 0
      ? [{ text: 'Nothing pending' }]
      : [
        { text: `${tasksDue} due today` },
        ...(tasksOverdue > 0 ? [{ text: ' · ' }, { text: `${tasksOverdue} overdue`, tone: 'bad' as const }] : []),
      ],
  });
  if (hasModule('rate_broadcast')) {
    rows.push({ key: 'rate_broadcast', title: 'Rate Broadcast', icon: 'megaphone-outline', route: '/settings/rate-broadcast', segs: [{ text: 'Rates to customers on WhatsApp' }] });
  }
  if (hasModule('website')) {
    rows.push({ key: 'website', title: 'Website', icon: 'globe-outline', route: '/website', segs: [{ text: 'Edit rmj.co.in — words, photos, sections' }] });
  }
  if (hasModule('cash_book')) {
    rows.push({ key: 'cash', title: 'Cash Book', icon: 'wallet-outline', route: '/cashbook', segs: [{ text: 'Record cash in / out' }] });
  }
  if (hasDocs) {
    rows.push({
      key: 'documents', title: 'Documents', icon: 'documents-outline', route: '/documents',
      badge: docPending || undefined,
      segs: docPending && docPending > 0 ? [{ text: `${docPending} pending to record`, tone: 'hot' }] : [{ text: 'Snap receipts, KYC & bills' }],
    });
  }


  const renderRow = (r: Row) => (
    <Pressable key={r.key} onPress={() => go(r.route)} style={({ pressed }) => [styles.prow, pressed && { opacity: 0.85 }]} testID={`emp-work-row-${r.key}`}>
      <View style={styles.pi}><Ionicons name={r.icon} size={22} color={colors.brandSecondary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pt}>{r.title}</Text>
        <Text style={styles.pd} numberOfLines={1}>
          {r.segs.map((s, i) => (
            <Text key={i} style={s.tone === 'hot' ? { color: colors.onWarning } : s.tone === 'bad' ? { color: colors.onError } : s.tone === 'strong' ? { color: colors.onSurface, fontWeight: '700' } : undefined}>{s.text}</Text>
          ))}
        </Text>
      </View>
      {r.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{r.badge}</Text></View> : <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-work-screen">
      <StickyHeader scrolled={scrolled}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Work</Text>
            <Text style={styles.sub}>What&apos;s in progress — and what to do next.</Text>
          </View>
          <UploadQueueBadge />
        </View>
      </StickyHeader>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >

        <AppSetupBanner />

        <Text style={styles.sectionLabel}>In progress</Text>
        {rows.map(renderRow)}

        <View style={{ height: spacing.xxl }} />
        <TabBarSpacer />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  h1: { color: colors.onSurface, fontSize: 30, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sectionLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.md },

  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800' },
});
