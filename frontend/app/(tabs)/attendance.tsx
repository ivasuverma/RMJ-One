import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istTime, todayIST, shiftedISTDate, displayDateOnly, localDateStr } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Row = {
  employee_id: string; employee_code: string; name: string;
  department: string; designation: string; shift: string;
  status: string; check_in?: string | null; check_out?: string | null;
  is_late?: boolean; working_hours?: number; missing_punch?: boolean; employee_status?: string;
  photo?: string;
};
type Ev = {
  id: string; employee_name: string; type: 'check_in' | 'check_out';
  timestamp: string; is_late?: boolean; working_hours?: number;
};

const TABS = ['Today', 'Live'] as const;

type StatusKey = 'all' | 'present' | 'late' | 'half_day' | 'absent' | 'missing';

const STATUS_FILTERS: { key: StatusKey; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'present', label: 'Present', icon: 'checkmark-circle-outline' },
  { key: 'late', label: 'Late', icon: 'alarm-outline' },
  { key: 'half_day', label: 'Half Day', icon: 'time-outline' },
  { key: 'missing', label: 'Missing Punch', icon: 'alert-circle-outline' },
  { key: 'absent', label: 'Absent', icon: 'close-circle-outline' },
];

// Present = checked in within shift + grace. Late = checked in after grace.
// Half Day = checked in after the shift's half-day-master threshold (or
// short hours). Missing Punch = an incomplete/contradictory punch pair —
// checked in with no check-out past shift end, OR checked out with no
// check-in at all — never counted as a full present day. Absent covers
// everything else with no attendance (including on-leave/holiday days,
// which still show their own pill on the row itself).
function statusKeyOf(row: Row): StatusKey {
  if (row.status === 'missing_punch') return 'missing';
  if (row.status === 'half_day') return 'half_day';
  if (row.status === 'present') return row.is_late ? 'late' : 'present';
  return 'absent';
}

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—:—';
  const t = istTime(iso);
  return t || '—:—';
};

const VALID_STATUS_KEYS = new Set(STATUS_FILTERS.map((f) => f.key));

const fmtDateLabel = (ds: string) => {
  if (ds === todayIST()) return 'Today';
  if (ds === shiftedISTDate(-1)) return 'Yesterday';
  return displayDateOnly(ds);
};

export default function OwnerAttendance() {
  const router = useRouter();
  const { from, filter } = useLocalSearchParams<{ from?: string; filter?: string }>();
  const goBack = () => { if (from === 'transactions') router.replace('/(tabs)/transactions' as any); else router.back(); };
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<typeof TABS[number]>('Today');
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusKey>(
    (filter && VALID_STATUS_KEYS.has(filter as StatusKey)) ? (filter as StatusKey) : 'all',
  );
  const [deptFilter, setDeptFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(() => todayIST());
  const isToday = date === todayIST();

  // Coming in from a dashboard tile (e.g. tapping "Present") should re-apply
  // that filter even if this screen was already mounted from a previous visit.
  useFocusEffect(useCallback(() => {
    if (filter && VALID_STATUS_KEYS.has(filter as StatusKey)) setStatusFilter(filter as StatusKey);
  }, [filter]));

  const load = useCallback(async () => {
    try {
      const [r, e, corr, leaves] = await Promise.all([
        api.get<Row[]>(`/attendance/today?date=${date}`).catch(() => []),
        api.get<Ev[]>('/attendance/live').catch(() => []),
        api.get<any[]>('/attendance/corrections?status=pending').catch(() => []),
        api.get<any[]>('/leaves?status=pending').catch(() => []),
      ]);
      setRows(r);
      setEvents(e);
      setPendingCount(corr.length + leaves.length);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stepDate = (deltaDays: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const next = localDateStr(d);
    if (next > todayIST()) return; // no future dates
    setLoading(true);
    setDate(next);
  };

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && statusKeyOf(r) !== statusFilter) return false;
      if (deptFilter !== 'all' && r.department !== deptFilter) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.employee_code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, deptFilter, query]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="attendance-screen">
      <View style={styles.header}>
        {(router.canGoBack() || from === 'transactions') && (
          <Pressable onPress={goBack} style={styles.backBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        )}
        <Text style={styles.title}>Attendance</Text>
        <Pressable
          testID="approvals-btn"
          onPress={() => router.push('/approvals')}
          style={styles.approvalsBtn}
        >
          <Ionicons name="checkmark-done-circle-outline" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.approvalsText}>Approvals</Text>
          {pendingCount > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{pendingCount}</Text></View>
          )}
        </Pressable>
      </View>

      {/* Sub-tabs */}
      <View style={styles.segRow}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            testID={`att-tab-${t.toLowerCase()}`}
            onPress={() => setTab(t)}
            style={[styles.segBtn, tab === t && styles.segBtnActive]}
          >
            <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'Today' && (
        <View style={styles.dateRow} testID="att-date-row">
          <Pressable onPress={() => stepDate(-1)} style={styles.dateNav} testID="att-date-prev" hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
          </Pressable>
          <View style={styles.dateLabel}>
            <Ionicons name="calendar-outline" size={13} color={colors.mutedText} />
            <Text style={styles.dateText}>{fmtDateLabel(date)}</Text>
          </View>
          <Pressable
            onPress={() => stepDate(1)}
            style={[styles.dateNav, isToday && { opacity: 0.35 }]}
            disabled={isToday}
            testID="att-date-next"
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
      )}

      {tab === 'Today' && !loading && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
            {STATUS_FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setStatusFilter(f.key)}
                style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
                testID={`att-filter-${f.key}`}
              >
                <Ionicons name={f.icon} size={13} color={statusFilter === f.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.filterText, statusFilter === f.key && styles.filterTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {departments.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
              <Pressable onPress={() => setDeptFilter('all')} style={[styles.filterChip, deptFilter === 'all' && styles.filterChipActive]} testID="att-dept-all">
                <Text style={[styles.filterText, deptFilter === 'all' && styles.filterTextActive]}>All Departments</Text>
              </Pressable>
              {departments.map((d) => (
                <Pressable key={d} onPress={() => setDeptFilter(d)} style={[styles.filterChip, deptFilter === d && styles.filterChipActive]} testID={`att-dept-${d}`}>
                  <Text style={[styles.filterText, deptFilter === d && styles.filterTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color={colors.mutedText} />
            <TextInput
              testID="att-search" value={query} onChangeText={setQuery}
              placeholder="Search by name or code" placeholderTextColor={colors.mutedText}
              style={styles.searchInput}
            />
          </View>
        </>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'Today' ? (
            filteredRows.length === 0 ? (
              <EmptyBox icon="people-outline" title="No matches" subtitle={rows.length === 0 ? 'Add employees first' : 'Try a different filter'} />
            ) : filteredRows.map((r) => (
              <Pressable
                key={r.employee_id}
                style={styles.row}
                testID={`att-row-${r.employee_id}`}
                onPress={() => router.push(`/attendance/calendar/${r.employee_id}`)}
              >
                {r.photo ? (
                  <Image source={{ uri: r.photo }} style={styles.avatarPhoto} />
                ) : (
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials(r.name)}</Text></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{r.designation || '—'} · {r.employee_code}</Text>
                  <View style={styles.rowTimes}>
                    <Ionicons name="log-in-outline" size={12} color={colors.mutedText} />
                    <Text style={styles.rowTime}>{fmtTime(r.check_in)}</Text>
                    <Text style={styles.rowSep}>·</Text>
                    <Ionicons name="log-out-outline" size={12} color={colors.mutedText} />
                    <Text style={styles.rowTime}>{fmtTime(r.check_out)}</Text>
                    {!!r.working_hours && <Text style={styles.hoursTag}>{r.working_hours}h</Text>}
                  </View>
                </View>
                <StatusPill row={r} />
              </Pressable>
            ))
          ) : (
            events.length === 0 ? (
              <EmptyBox icon="pulse-outline" title="No activity yet" subtitle="Punches will appear here in real time" />
            ) : events.map((e) => (
              <View key={e.id} style={styles.eventRow} testID={`event-${e.id}`}>
                <View style={[styles.dot, { backgroundColor: e.type === 'check_in' ? colors.brandPrimary : colors.brandSecondary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventText}>
                    <Text style={{ fontWeight: '700' }}>{e.employee_name}</Text>
                    {' '}{e.type === 'check_in' ? 'checked in' : 'checked out'}
                  </Text>
                  {!!e.working_hours && <Text style={styles.eventMeta}>{e.working_hours} hours worked</Text>}
                  {e.type === 'check_in' && e.is_late && <Text style={styles.lateMeta}>Marked late</Text>}
                </View>
                <Text style={styles.eventTime}>{fmtTime(e.timestamp)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

function StatusPill({ row }: { row: Row }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  let label = 'Absent', bg = colors.error, bd = colors.onError, fg = colors.onError;
  if (row.status === 'leave') { label = 'Leave'; bg = colors.warning; bd = colors.onWarning; fg = colors.onWarning; }
  else if (row.status === 'holiday') { label = 'Holiday'; bg = colors.warning; bd = colors.onWarning; fg = colors.onWarning; }
  else if (row.status === 'missing_punch') { label = 'Missing'; bg = colors.error; bd = colors.onError; fg = colors.onError; }
  else if (row.status === 'half_day') { label = 'Half Day'; bg = colors.warning; bd = colors.onWarning; fg = colors.onWarning; }
  else if (row.status === 'present') {
    label = row.is_late ? 'Late' : 'Present';
    bg = row.is_late ? colors.warning : colors.success;
    bd = row.is_late ? colors.onWarning : colors.onSuccess;
    fg = row.is_late ? colors.onWarning : colors.onSuccess;
  }
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function EmptyBox({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.emptyBox}>
      <Ionicons name={icon} size={44} color={colors.mutedText} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 30, fontWeight: '600',
    fontFamily: fonts.display,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  approvalsBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.brandPrimary,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
  },
  approvalsText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.onBrandPrimary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.brandPrimary, fontWeight: '800', fontSize: 11 },

  segRow: {
    flexDirection: 'row', marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: colors.onBrandPrimary },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  dateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  dateNav: {
    width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  dateLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },

  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 2 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.onBrandPrimary },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 10, fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700' },
  avatarPhoto: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary },
  rowName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  rowTimes: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  rowTime: { color: colors.mutedText, fontSize: 11 },
  rowSep: { color: colors.mutedText, fontSize: 12, marginHorizontal: 2 },
  hoursTag: { color: colors.brandSecondary, fontSize: 10, fontWeight: '700', marginLeft: 6, backgroundColor: colors.brandTertiary, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' },

  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  eventText: { color: colors.onSurface, fontSize: 13 },
  eventMeta: { color: colors.brandSecondary, fontSize: 11, marginTop: 2 },
  lateMeta: { color: colors.onWarning, fontSize: 11, marginTop: 2 },
  eventTime: { color: colors.mutedText, fontSize: 11 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  emptySub: { color: colors.onSurfaceTertiary, fontSize: 12 },
});
