import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Screen, Section, Skeleton, ErrorState, Tone } from '@/src/components/ui';

// Work is a board of live processes now (v2 Phase 4), not a static tile grid.
// Every section shows its current state — pipeline counts, balances, what's
// overdue — before you tap, and each stage deep-links to exactly that slice.
// It reuses /api/dashboard (same source as the Dashboard) so the numbers
// always agree with the home screen and never need a second endpoint.
type DashboardData = {
  todays_attendance: { present: number; total: number; working: number };
  pending_approvals: { attendance_corrections: number; leave_requests: number };
  repairs_summary: { received: number; with_karigar: number; ready: number; overdue: number; delivered_today: number; total_open: number };
  tasks_summary: { due_today: number; overdue: number; done_today: number; open_total: number };
  samples_summary: { with_karigar: number; overdue: number; received_today: number };
  cashbook_summary: { received_today: number; paid_today: number; closing_balance: number };
  business_summary: { revenue_month: number; fine_with_karigars: number; customers_open: number; karigars_open: number };
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

type Stage = { key: string; label: string; count: number; tone: Tone; route: string };

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (silent?: boolean) => {
    try {
      setError('');
      setData(await api.get<DashboardData>('/dashboard'));
    } catch (e: any) {
      if (!silent) setError(e?.detail || 'Failed to load');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const go = (route: string) => router.push(route as any);

  const showRepairs = hasModule('repairs');
  const showSamples = hasModule('samples');
  const showCash = hasModule('cash_book');
  const showTasks = hasModule('tasks');
  const showTeam = hasModule('attendance') || hasModule('payroll');
  const showLedger = hasModule('ledger');
  const showReports = hasModule('reports');

  const nothing = !showRepairs && !showSamples && !showCash && !showTasks && !showTeam && !showLedger && !showReports;

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} testID="work-screen">
      <Text style={styles.title}>Work</Text>
      <Text style={styles.subtitle}>Everything you do, live.</Text>

      {loading && !data ? (
        <WorkSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} testID="work-error" />
      ) : data ? (
        <>
          {/* Repairs — pipeline with billing merged in (a Ready item is billed
              in place via the Ready → bill flow, no separate destination). */}
          {showRepairs && (
            <Section
              title="Repairs"
              icon="construct-outline"
              testID="work-repairs"
              subtitle={data.repairs_summary.delivered_today > 0 ? `${data.repairs_summary.delivered_today} delivered today` : undefined}
              right={<SeeAll onPress={() => go('/repairs')} />}
            >
              <PipelineBar
                stages={[
                  { key: 'received', label: 'Issue pending', count: data.repairs_summary.received, tone: 'neutral', route: '/repairs?filter=received' },
                  { key: 'with_karigar', label: 'With karigar', count: data.repairs_summary.with_karigar, tone: 'info', route: '/repairs?filter=with_karigar' },
                  { key: 'ready', label: 'Ready to bill', count: data.repairs_summary.ready, tone: 'success', route: '/repairs/bill?filter=ready' },
                  { key: 'overdue', label: 'Overdue', count: data.repairs_summary.overdue, tone: 'error', route: '/repairs?filter=overdue' },
                ]}
                onGo={go}
              />
            </Section>
          )}

          {/* Stock In/Out */}
          {showSamples && (
            <Section
              title="Stock In/Out"
              icon="diamond-outline"
              testID="work-samples"
              subtitle={data.samples_summary.received_today > 0 ? `${data.samples_summary.received_today} returned today` : undefined}
              right={<SeeAll onPress={() => go('/samples')} />}
            >
              <PipelineBar
                stages={[
                  { key: 'with_karigar', label: 'With karigar', count: data.samples_summary.with_karigar, tone: 'info', route: '/samples?status=with_karigar' },
                  { key: 'overdue', label: 'Overdue', count: data.samples_summary.overdue, tone: 'error', route: '/samples?status=overdue' },
                ]}
                onGo={go}
              />
            </Section>
          )}

          {/* Cash Book — state + balance. (Close-day action is deferred; see
              PR notes — it needs a per-counter day-close data model.) */}
          {showCash && (
            <Section title="Cash Book" icon="wallet-outline" testID="work-cashbook" right={<SeeAll onPress={() => go('/cashbook')} />}>
              <Pressable onPress={() => go('/cashbook')} style={({ pressed }) => [styles.balanceCard, pressed && { opacity: 0.85 }]} testID="work-cashbook-card">
                <View>
                  <Text style={styles.balanceLabel}>Counter balance (all books)</Text>
                  <Text style={styles.balanceValue}>{fmtINR(data.cashbook_summary.closing_balance)}</Text>
                </View>
                <View style={styles.balanceMeta}>
                  <Text style={[styles.balanceMetaText, { color: colors.onSuccess }]}>+{fmtINR(data.cashbook_summary.received_today)}</Text>
                  <Text style={[styles.balanceMetaText, { color: colors.onError }]}>−{fmtINR(data.cashbook_summary.paid_today)}</Text>
                  <Text style={styles.balanceMetaSub}>today</Text>
                </View>
              </Pressable>
            </Section>
          )}

          {/* Tasks */}
          {showTasks && (
            <Section title="Tasks" icon="checkbox-outline" testID="work-tasks" right={<SeeAll onPress={() => go('/tasks')} />}>
              <PipelineBar
                stages={[
                  { key: 'due', label: 'Due today', count: data.tasks_summary.due_today, tone: 'info', route: '/tasks' },
                  { key: 'overdue', label: 'Overdue', count: data.tasks_summary.overdue, tone: 'error', route: '/tasks' },
                ]}
                onGo={go}
              />
            </Section>
          )}

          {/* Payroll & Attendance — combined, low-frequency (weekly) team area. */}
          {showTeam && (
            <Section title="Payroll & attendance" icon="people-outline" testID="work-team">
              <View style={styles.teamCard}>
                {hasModule('attendance') && (
                  <View style={styles.teamStatRow}>
                    <Text style={styles.teamStatLabel}>Working now</Text>
                    <Text style={styles.teamStatValue}>{data.todays_attendance.working} / {data.todays_attendance.total}</Text>
                  </View>
                )}
                {hasModule('approvals') && (data.pending_approvals.attendance_corrections + data.pending_approvals.leave_requests) > 0 && (
                  <View style={styles.teamStatRow}>
                    <Text style={styles.teamStatLabel}>Approvals waiting</Text>
                    <Text style={[styles.teamStatValue, { color: colors.onError }]}>{data.pending_approvals.attendance_corrections + data.pending_approvals.leave_requests}</Text>
                  </View>
                )}
                <View style={styles.teamBtnRow}>
                  {hasModule('attendance') && <TeamBtn icon="time-outline" label="Attendance" onPress={() => go('/(tabs)/attendance?from=work')} testID="work-team-attendance" />}
                  {hasModule('payroll') && <TeamBtn icon="cash-outline" label="Payroll" onPress={() => go('/(tabs)/payroll?from=work')} testID="work-team-payroll" />}
                  <TeamBtn icon="add-circle-outline" label="Advance / deduction" onPress={() => go('/(tabs)/employees?from=work')} testID="work-team-advance" />
                </View>
              </View>
            </Section>
          )}

          {/* Ledger — the unified dual-balance account list (v2 Phase 5). One
              entity per account with a type; filters + statement live inside. */}
          {(showLedger || showReports) && (
            <Section title="Ledger" icon="book-outline" testID="work-ledger">
              <View style={styles.ledgerRow}>
                {showLedger && <LedgerBtn icon="book-outline" label="Open Ledger" onPress={() => go('/accounts')} testID="work-ledger-open" />}
                {showLedger && <LedgerBtn icon="add-circle-outline" label="New account" onPress={() => go('/accounts/new')} testID="work-ledger-new" />}
                {showReports && <LedgerBtn icon="document-text-outline" label="Reports & PDFs" onPress={() => go('/reports/generate')} testID="work-ledger-reports" />}
              </View>
            </Section>
          )}

          {nothing && (
            <View style={styles.empty} testID="work-empty">
              <Ionicons name="briefcase-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>Nothing assigned to you yet. Ask the owner to grant you access.</Text>
            </View>
          )}

          <View style={{ height: spacing.xxl }} />
        </>
      ) : null}
    </Screen>
  );
}

/* ---------------- Pipeline bar ---------------- */
function PipelineBar({ stages, onGo }: { stages: Stage[]; onGo: (route: string) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tones = TONE_COLORS(colors);
  return (
    <View style={styles.pipeline}>
      {stages.map((s, i) => {
        // A zero count is muted so a live "Overdue" chip doesn't read as an
        // alarm when there's nothing overdue — but the stage stays in place.
        const t = s.count === 0 ? tones.neutral : tones[s.tone];
        return (
          <Pressable
            key={s.key}
            onPress={() => onGo(s.route)}
            style={({ pressed }) => [styles.stage, { backgroundColor: t.bg, borderColor: t.border }, i > 0 && { marginLeft: 6 }, pressed && { opacity: 0.8 }]}
            testID={`pipeline-${s.key}`}
          >
            <Text style={[styles.stageCount, { color: t.fg }]}>{s.count}</Text>
            <Text style={[styles.stageLabel, { color: t.fg }]} numberOfLines={2}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SeeAll({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable onPress={onPress} testID="work-see-all"><Text style={{ color: colors.brandSecondary, fontSize: 12, fontWeight: '700' }}>See all</Text></Pressable>;
}

function TeamBtn({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.teamBtn, pressed && { opacity: 0.8 }]} testID={testID}>
      <Ionicons name={icon} size={16} color={colors.brandSecondary} />
      <Text style={styles.teamBtnText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function LedgerBtn({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ledgerBtn, pressed && { opacity: 0.8 }]} testID={testID}>
      <View style={styles.ledgerIcon}><Ionicons name={icon} size={18} color={colors.brandPrimary} /></View>
      <Text style={styles.ledgerBtnText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function WorkSkeleton() {
  return (
    <View style={{ gap: spacing.lg }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={{ gap: spacing.sm }}>
          <Skeleton width="35%" height={14} />
          <Skeleton width="100%" height={64} radius={radius.md} />
        </View>
      ))}
    </View>
  );
}

const TONE_COLORS = (colors: ThemeColors): Record<Tone, { bg: string; border: string; fg: string }> => ({
  neutral: { bg: colors.surfaceSecondary, border: colors.border, fg: colors.onSurface },
  brand: { bg: colors.brandTertiary, border: colors.brand, fg: colors.brandSecondary },
  success: { bg: colors.success, border: colors.success, fg: colors.onSuccess },
  warning: { bg: colors.warning, border: colors.warning, fg: colors.onWarning },
  error: { bg: colors.error, border: colors.error, fg: colors.onError },
  info: { bg: colors.info, border: colors.info, fg: colors.onInfo },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: 4 },
  subtitle: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg },

  pipeline: { flexDirection: 'row' },
  stage: {
    flex: 1, borderRadius: radius.md, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center',
  },
  stageCount: { fontSize: 20, fontWeight: '800', fontFamily: fonts.display },
  stageLabel: { fontSize: 10.5, fontWeight: '600', textAlign: 'center', marginTop: 2, opacity: 0.9 },

  balanceCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  balanceLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  balanceValue: { color: colors.onSurface, fontSize: 22, fontWeight: '800', fontFamily: fonts.display, marginTop: 3 },
  balanceMeta: { alignItems: 'flex-end' },
  balanceMetaText: { fontSize: 12.5, fontWeight: '800' },
  balanceMetaSub: { color: colors.mutedText, fontSize: 10, marginTop: 1 },

  teamCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: spacing.sm,
  },
  teamStatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamStatLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  teamStatValue: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  teamBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  teamBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: spacing.sm,
  },
  teamBtnText: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700' },

  ledgerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  ledgerBtn: {
    flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  ledgerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand },
  ledgerBtnText: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '700' },

  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center' },
});
