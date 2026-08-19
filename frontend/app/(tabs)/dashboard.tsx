import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { nowISTLongLabel } from '@/src/utils/datetime';
import { useCountUp } from '@/src/hooks/use-count-up';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Screen, Section, StatTile, Skeleton, ErrorState, DualBalance, Tone } from '@/src/components/ui';

type DashboardData = {
  todays_attendance: {
    present: number; absent: number; late: number; half_day: number;
    missing_punch: number; not_checked_in: number; leave: number; working: number; total: number;
  };
  pending_approvals: { attendance_corrections: number; leave_requests: number };
  repairs_summary: {
    received: number; with_karigar: number; ready: number;
    overdue: number; delivered_today: number; total_open: number;
  };
  tasks_summary: { due_today: number; overdue: number; done_today: number; open_total: number };
  samples_summary: { with_karigar: number; overdue: number; received_today: number };
  cashbook_summary: { received_today: number; paid_today: number; closing_balance: number };
  business_summary: {
    revenue_today: number; revenue_month: number; intake_today: number; active_employees: number;
    customers_open: number; karigars_open: number; fine_with_karigars: number; karigar_amt_payable: number;
  };
};

// Poll cadence tightened to ~15s (was 45s) so the "Live" pill reads honestly
// and value changes tick over on their own while the screen is open.
const AUTO_REFRESH_MS = 15000;
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

function timeAgo(d: Date | null) {
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

// One actionable item in the needs-attention briefing — only ever built for a
// non-zero count, and always deep-links to the exact place it's fixed.
type AttnItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tone: Tone; route: string };

export default function DashboardScreen() {
  const { user, hasModule } = useAuth();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, forceTick] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const isWide = width >= 900;

  const load = useCallback(async (silent?: boolean) => {
    try {
      setError('');
      const res = await api.get<DashboardData>('/dashboard');
      setData(res);
      setLastUpdated(new Date());
    } catch (e: any) {
      if (!silent) setError(e?.detail || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    api.get<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
    const poll = setInterval(() => load(true), AUTO_REFRESH_MS);
    const clock = setInterval(() => forceTick((t) => t + 1), 15000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  // Build the needs-attention list from the payload — only non-zero items,
  // each gated on the caller actually having that module.
  const attnItems = useMemo<AttnItem[]>(() => {
    if (!data) return [];
    const items: AttnItem[] = [];
    const a = data.todays_attendance;
    if (hasModule('attendance')) {
      if (a.not_checked_in > 0) items.push({ key: 'nci', label: `${a.not_checked_in} not checked in`, icon: 'hourglass-outline', tone: 'warning', route: '/(tabs)/attendance?filter=absent' });
      if (a.absent > 0) items.push({ key: 'absent', label: `${a.absent} absent`, icon: 'close-circle-outline', tone: 'error', route: '/(tabs)/attendance?filter=absent' });
      if (a.missing_punch > 0) items.push({ key: 'mp', label: `${a.missing_punch} missing a punch`, icon: 'alert-circle-outline', tone: 'error', route: '/(tabs)/attendance?filter=missing' });
    }
    if (hasModule('repairs') && data.repairs_summary.overdue > 0) {
      items.push({ key: 'rep-od', label: `${data.repairs_summary.overdue} repair${data.repairs_summary.overdue === 1 ? '' : 's'} overdue`, icon: 'construct-outline', tone: 'error', route: '/repairs?filter=overdue' });
    }
    if (hasModule('samples') && data.samples_summary.overdue > 0) {
      items.push({ key: 'smp-od', label: `${data.samples_summary.overdue} stock item${data.samples_summary.overdue === 1 ? '' : 's'} overdue`, icon: 'diamond-outline', tone: 'error', route: '/samples?status=overdue' });
    }
    if (hasModule('tasks') && data.tasks_summary.overdue > 0) {
      items.push({ key: 'task-od', label: `${data.tasks_summary.overdue} task${data.tasks_summary.overdue === 1 ? '' : 's'} overdue`, icon: 'alert-circle-outline', tone: 'error', route: '/tasks?filter=overdue' });
    }
    if (hasModule('tasks') && data.tasks_summary.due_today > 0) {
      items.push({ key: 'task-due', label: `${data.tasks_summary.due_today} task${data.tasks_summary.due_today === 1 ? '' : 's'} due today`, icon: 'today-outline', tone: 'info', route: '/tasks?filter=today' });
    }
    return items;
  }, [data, hasModule]);

  const showAttendanceTile = hasModule('attendance');
  const showCashTile = hasModule('cash_book') || hasModule('karigar_ledger');
  const showRepairsTile = hasModule('repairs');
  const showRevenueTile = hasModule('reports') || hasModule('repairs');

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={isWide ? styles.scrollWide : undefined}
      testID="dashboard-screen"
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dateText}>{nowISTLongLabel()}</Text>
          <Text style={styles.owner} numberOfLines={1}>{user?.name || 'Owner'}</Text>
          <View style={styles.livePill} testID="dashboard-live-pill">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live · updated {timeAgo(lastUpdated) || 'just now'}</Text>
          </View>
        </View>
        <Pressable onPress={() => setSearchOpen(true)} style={styles.iconBtn} testID="dashboard-search-btn" hitSlop={10}>
          <Ionicons name="search-outline" size={19} color={colors.onSurface} />
        </Pressable>
        <Pressable onPress={() => router.push('/notifications' as any)} style={styles.iconBtn} testID="notifications-btn" hitSlop={10}>
          <Ionicons name="notifications-outline" size={19} color={colors.onSurface} />
          {unread > 0 && <View style={styles.bellDot} />}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/utility' as any)} style={styles.iconBtn} testID="dashboard-settings-btn" hitSlop={10}>
          <Ionicons name="settings-outline" size={19} color={colors.onSurface} />
        </Pressable>
        <Image source={images.logo} style={styles.headerBadge} contentFit="contain" testID="dashboard-logo" />
      </View>

      {loading && !data ? (
        <DashboardSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} testID="dashboard-error" />
      ) : data ? (
        <>
          {/* 1. Needs-attention briefing */}
          <NeedsAttention items={attnItems} onGo={(r) => router.push(r as any)} />

          {/* 2. Glance stats — a dual gold+cash card + up to 3 headline tiles */}
          <Section title="At a glance" icon="stats-chart-outline" testID="section-glance">
            {showCashTile && (
              <View style={styles.dualCard} testID="glance-dual">
                <Text style={styles.dualLabel}>Cash & gold position</Text>
                <DualBalance
                  amount={data.cashbook_summary.closing_balance}
                  fineGrams={data.business_summary.fine_with_karigars}
                  negativeLabel="paid out"
                />
                <Text style={styles.dualHint}>Counter balance across all cash books · fine gold out with karigars</Text>
              </View>
            )}
            <View style={styles.tileRow}>
              {showAttendanceTile && (
                <CountTile icon="people-outline" label="Present today" value={data.todays_attendance.present} suffix={` / ${data.todays_attendance.total}`} tone="success" onPress={() => router.push('/(tabs)/attendance?filter=present' as any)} testID="glance-present" />
              )}
              {showRepairsTile && (
                <CountTile icon="construct-outline" label="Repairs open" value={data.repairs_summary.total_open} tone="brand" onPress={() => router.push('/repairs' as any)} testID="glance-repairs" />
              )}
              {showRevenueTile && (
                <MoneyTile icon="trending-up-outline" label="Revenue (month)" value={data.business_summary.revenue_month} tone="info" testID="glance-revenue" />
              )}
            </View>
          </Section>

          {/* 3. Approvals + Leave */}
          {hasModule('approvals') && (
            <ApprovalsSection onChanged={() => load(true)} />
          )}

          <View style={{ height: 96 }} />
        </>
      ) : null}

      {/* Compose ＋ button */}
      <Pressable onPress={() => setComposeOpen(true)} style={styles.fab} testID="dashboard-compose-btn">
        <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
      </Pressable>

      <ComposeSheet visible={composeOpen} onClose={() => setComposeOpen(false)} />
      <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </Screen>
  );
}

/* ---------------- Needs-attention briefing ---------------- */
function NeedsAttention({ items, onGo }: { items: AttnItem[]; onGo: (route: string) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toneColors = TONE_COLORS(colors);

  if (items.length === 0) {
    return (
      <View style={styles.allClear} testID="needs-attention-clear">
        <Ionicons name="checkmark-circle" size={22} color={colors.onSuccess} />
        <View style={{ flex: 1 }}>
          <Text style={styles.allClearTitle}>All clear</Text>
          <Text style={styles.allClearSub}>Nothing needs your attention right now.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.attnWrap} testID="needs-attention">
      <Text style={styles.attnLead}>
        {items.length === 1 ? '1 thing needs your attention' : `${items.length} things need your attention`}
      </Text>
      <View style={styles.attnCard}>
        {items.map((it, i) => {
          const t = toneColors[it.tone];
          return (
            <Pressable
              key={it.key}
              onPress={() => onGo(it.route)}
              testID={`needs-attention-${it.key}`}
              style={({ pressed }) => [styles.attnRow, i === items.length - 1 && styles.attnRowLast, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.attnIcon, { backgroundColor: t.bg }]}>
                <Ionicons name={it.icon} size={14} color={t.fg} />
              </View>
              <Text style={styles.attnLabel}>{it.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ---------------- Count-up stat tiles ---------------- */
function CountTile({ icon, label, value, suffix, tone, onPress, testID }: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; label: string; value: number; suffix?: string; tone: Tone; onPress?: () => void; testID?: string;
}) {
  const display = useCountUp(value);
  return <StatTile icon={icon} label={label} value={`${Math.round(display)}${suffix || ''}`} tone={tone} onPress={onPress} basis="30%" testID={testID} />;
}

function MoneyTile({ icon, label, value, tone, onPress, testID }: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; label: string; value: number; tone: Tone; onPress?: () => void; testID?: string;
}) {
  const display = useCountUp(value);
  return <StatTile icon={icon} label={label} value={fmtINR(display)} tone={tone} onPress={onPress} basis="30%" testID={testID} />;
}

/* ---------------- Approvals + Leave ---------------- */
type Correction = { id: string; employee_name: string; date: string; reason_type: string; status: string };
type Leave = { id: string; employee_name: string; from_date: string; to_date: string; leave_type: string; status: string };

function ApprovalsSection({ onChanged }: { onChanged: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const inFlight = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      api.get<Correction[]>('/attendance/corrections').catch(() => []),
      api.get<Leave[]>('/leaves').catch(() => []),
    ]);
    setCorrections(c.filter((x) => x.status === 'pending'));
    setLeaves(l.filter((x) => x.status === 'pending'));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async (kind: 'correction' | 'leave', id: string, action: 'approve' | 'reject') => {
    const key = `${kind}:${id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const path = kind === 'correction' ? `/attendance/corrections/${id}/decide` : `/leaves/${id}/decide`;
      await api.post(path, { action });
      await load();
      onChanged();
    } catch { /* surfaced on next load */ }
    finally { inFlight.current.delete(key); }
  };

  const total = corrections.length + leaves.length;
  if (total === 0) return null;

  return (
    <Section
      title="Approvals & leave"
      icon="checkmark-done-outline"
      testID="section-approvals"
      right={
        <Pressable onPress={() => router.push('/approvals')} testID="approvals-see-all">
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      }
    >
      <View style={styles.attnCard}>
        {corrections.slice(0, 4).map((c, i) => (
          <ApprovalRow
            key={c.id}
            title={c.employee_name}
            subtitle={`Correction · ${c.date}`}
            last={i === corrections.slice(0, 4).length - 1 && leaves.length === 0}
            onApprove={() => decide('correction', c.id, 'approve')}
            onReject={() => decide('correction', c.id, 'reject')}
            testID={`approval-correction-${c.id}`}
          />
        ))}
        {leaves.slice(0, 4).map((l, i) => (
          <ApprovalRow
            key={l.id}
            title={l.employee_name}
            subtitle={`Leave · ${l.from_date}${l.to_date && l.to_date !== l.from_date ? `–${l.to_date}` : ''}`}
            last={i === leaves.slice(0, 4).length - 1}
            onApprove={() => decide('leave', l.id, 'approve')}
            onReject={() => decide('leave', l.id, 'reject')}
            testID={`approval-leave-${l.id}`}
          />
        ))}
      </View>
    </Section>
  );
}

function ApprovalRow({ title, subtitle, last, onApprove, onReject, testID }: {
  title: string; subtitle: string; last?: boolean; onApprove: () => void; onReject: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.apprRow, last && styles.attnRowLast]} testID={testID}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.apprName} numberOfLines={1}>{title}</Text>
        <Text style={styles.apprSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Pressable onPress={onReject} style={styles.apprReject} testID={testID ? `${testID}-reject` : undefined} hitSlop={6}>
        <Ionicons name="close" size={16} color={colors.onError} />
      </Pressable>
      <Pressable onPress={onApprove} style={styles.apprApprove} testID={testID ? `${testID}-approve` : undefined} hitSlop={6}>
        <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

/* ---------------- Compose action sheet ---------------- */
function ComposeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  type Action = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; show: boolean };
  const actions: Action[] = [
    { key: 'task', label: 'New task', icon: 'checkbox-outline', route: '/tasks/new', show: hasModule('tasks') },
    { key: 'repair', label: 'New repair', icon: 'construct-outline', route: '/repairs/new', show: hasModule('repairs') },
    { key: 'stock', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples/new', show: hasModule('samples') },
    { key: 'advance', label: 'Employee advance', icon: 'cash-outline', route: '/(tabs)/employees?from=work', show: hasModule('team') || hasModule('payroll') },
    { key: 'deduction', label: 'Employee deduction', icon: 'remove-circle-outline', route: '/(tabs)/employees?from=work', show: hasModule('team') || hasModule('payroll') },
    { key: 'cash', label: 'Cash in/out', icon: 'wallet-outline', route: '/cashbook', show: hasModule('cash_book') },
  ];
  const visibleActions = actions.filter((a) => a.show);

  const go = (route: string) => { onClose(); router.push(route as any); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} testID="compose-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Create</Text>
          {visibleActions.length === 0 ? (
            <Text style={styles.sheetEmpty}>Nothing to create with your current access.</Text>
          ) : visibleActions.map((a) => (
            <Pressable key={a.key} onPress={() => go(a.route)} style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.7 }]} testID={`compose-${a.key}`}>
              <View style={styles.sheetIcon}><Ionicons name={a.icon} size={18} color={colors.brandSecondary} /></View>
              <Text style={styles.sheetLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ---------------- Global search overlay ---------------- */
type SearchHit = { kind: 'customer' | 'karigar' | 'employee'; id: string; name: string; sub?: string; route: string };

function SearchOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setHits([]); return; }
    setSearching(true);
    try {
      // Search the party directories the caller can actually see. Selecting a
      // result opens its current detail screen; Phase 5 repoints these at the
      // unified ledger account view.
      const reqs: Promise<SearchHit[]>[] = [];
      if (hasModule('repairs') || hasModule('customer_ledger')) {
        reqs.push(api.get<any[]>(`/customers?q=${encodeURIComponent(query)}`).then((cs) => cs.slice(0, 8).map((c) => ({ kind: 'customer' as const, id: c.id, name: c.name, sub: c.mobile, route: `/customers/${c.id}` }))).catch(() => []));
      }
      if (hasModule('repairs') || hasModule('karigar_ledger')) {
        reqs.push(api.get<any[]>(`/karigars?q=${encodeURIComponent(query)}`).then((ks) => ks.slice(0, 8).map((k) => ({ kind: 'karigar' as const, id: k.id, name: k.name, sub: k.mobile, route: `/karigars/${k.id}` }))).catch(() => []));
      }
      if (hasModule('team') || hasModule('payroll')) {
        reqs.push(api.get<any[]>(`/employees?q=${encodeURIComponent(query)}`).then((es) => es.slice(0, 8).map((e) => ({ kind: 'employee' as const, id: e.id, name: e.name, sub: e.employee_code, route: `/ledger/${e.id}` }))).catch(() => []));
      }
      const results = (await Promise.all(reqs)).flat();
      setHits(results);
    } finally { setSearching(false); }
  }, [hasModule]);

  const onChange = (text: string) => {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(text), 250);
  };

  const go = (route: string) => { onClose(); setQ(''); setHits([]); router.push(route as any); };

  const KIND_ICON: Record<SearchHit['kind'], keyof typeof Ionicons.glyphMap> = {
    customer: 'person-outline', karigar: 'hammer-outline', employee: 'people-outline',
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.searchRoot} testID="search-overlay">
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.mutedText} />
          <TextInput
            value={q}
            onChangeText={onChange}
            placeholder="Search customers, karigars, staff…"
            placeholderTextColor={colors.mutedText}
            style={styles.searchInput}
            autoFocus
            testID="search-input"
          />
          <Pressable onPress={onClose} hitSlop={10} testID="search-close">
            <Text style={styles.searchCancel}>Cancel</Text>
          </Pressable>
        </View>
        {searching && <Text style={styles.searchHint}>Searching…</Text>}
        {!searching && q.trim() !== '' && hits.length === 0 && (
          <Text style={styles.searchHint}>No matches for “{q}”.</Text>
        )}
        <View>
          {hits.map((h) => (
            <Pressable key={`${h.kind}-${h.id}`} onPress={() => go(h.route)} style={({ pressed }) => [styles.searchRow, pressed && { opacity: 0.7 }]} testID={`search-hit-${h.id}`}>
              <View style={styles.searchIconWrap}><Ionicons name={KIND_ICON[h.kind]} size={16} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.searchName} numberOfLines={1}>{h.name}</Text>
                {!!h.sub && <Text style={styles.searchSub} numberOfLines={1}>{h.kind} · {h.sub}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Skeleton ---------------- */
function DashboardSkeleton() {
  return (
    <View style={{ gap: spacing.md }}>
      <Skeleton width="55%" height={16} />
      <Skeleton width="100%" height={72} radius={radius.md} />
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} width="30%" height={64} radius={radius.sm} />)}
      </View>
    </View>
  );
}

const TONE_COLORS = (colors: ThemeColors): Record<Tone, { bg: string; fg: string }> => ({
  neutral: { bg: colors.surfaceTertiary, fg: colors.onSurfaceSecondary },
  brand: { bg: colors.brandTertiary, fg: colors.brandSecondary },
  success: { bg: colors.success, fg: colors.onSuccess },
  warning: { bg: colors.warning, fg: colors.onWarning },
  error: { bg: colors.error, fg: colors.onError },
  info: { bg: colors.info, fg: colors.onInfo },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scrollWide: { maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
  dateText: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  owner: { color: colors.onSurface, fontSize: 26, fontWeight: '600', fontFamily: fonts.display, marginTop: 2 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onSuccess },
  liveText: { color: colors.mutedText, fontSize: 11 },
  headerBadge: { width: 40, height: 40, borderRadius: radius.md, marginLeft: 2 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.error, borderWidth: 1, borderColor: colors.surface,
  },

  // Needs-attention
  attnWrap: { marginBottom: spacing.lg },
  attnLead: { color: colors.onSurface, fontSize: 15, fontWeight: '700', marginBottom: spacing.sm },
  attnCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  attnRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 11, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  attnRowLast: { borderBottomWidth: 0 },
  attnIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  attnLabel: { flex: 1, color: colors.onSurface, fontSize: 13.5, fontWeight: '600' },

  allClear: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.success, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  allClearTitle: { color: colors.onSuccess, fontSize: 15, fontWeight: '800' },
  allClearSub: { color: colors.onSuccess, fontSize: 12, marginTop: 1, opacity: 0.9 },

  // Glance
  dualCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  dualLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  dualHint: { color: colors.mutedText, fontSize: 10.5, marginTop: 8 },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },

  seeAll: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700' },

  // Approvals
  apprRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  apprName: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  apprSub: { color: colors.mutedText, fontSize: 11, marginTop: 1 },
  apprReject: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.error, backgroundColor: colors.error,
  },
  apprApprove: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
  },

  // FAB
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },

  // Compose sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, paddingBottom: spacing.xxl, gap: 2,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700', fontFamily: fonts.display, marginBottom: spacing.sm },
  sheetEmpty: { color: colors.mutedText, fontSize: 13, paddingVertical: spacing.md },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  sheetIcon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  sheetLabel: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },

  // Search overlay
  searchRoot: { flex: 1, backgroundColor: colors.surface, paddingTop: 56, paddingHorizontal: spacing.lg },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 15, paddingVertical: 10 },
  searchCancel: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
  searchHint: { color: colors.mutedText, fontSize: 13, marginTop: spacing.lg },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  searchIconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  searchName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  searchSub: { color: colors.mutedText, fontSize: 11, marginTop: 1, textTransform: 'capitalize' },
});
