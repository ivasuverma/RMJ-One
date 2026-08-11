import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, fonts } from '@/src/theme';

type Row = {
  employee_id: string; employee_code: string; name: string;
  department: string; designation: string; shift: string;
  status: string; check_in?: string | null; check_out?: string | null;
  is_late?: boolean; working_hours?: number; missing_punch?: boolean; employee_status?: string;
};
type Ev = {
  id: string; employee_name: string; type: 'check_in' | 'check_out';
  timestamp: string; is_late?: boolean; working_hours?: number;
};

const TABS = ['Today', 'Live'] as const;

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—:—';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  catch { return '—:—'; }
};

export default function OwnerAttendance() {
  const router = useRouter();
  const [tab, setTab] = useState<typeof TABS[number]>('Today');
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [r, e, corr] = await Promise.all([
        api.get<Row[]>('/attendance/today').catch(() => []),
        api.get<Ev[]>('/attendance/live').catch(() => []),
        api.get<any[]>('/attendance/corrections?status=pending').catch(() => []),
      ]);
      setRows(r);
      setEvents(e);
      setPendingCount(corr.length);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="attendance-screen">
      <View style={styles.header}>
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
            rows.length === 0 ? (
              <EmptyBox icon="people-outline" title="No employees" subtitle="Add employees first" />
            ) : rows.map((r) => (
              <Pressable
                key={r.employee_id}
                style={styles.row}
                testID={`att-row-${r.employee_id}`}
                onPress={() => router.push(`/attendance/calendar/${r.employee_id}`)}
              >
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(r.name)}</Text></View>
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
  let label = 'Absent', bg = 'rgba(122,40,40,0.25)', bd = colors.error, fg = '#F1A9A9';
  if (row.employee_status === 'on_leave') { label = 'Leave'; bg = 'rgba(163,125,30,0.25)'; bd = colors.warning; fg = '#F1D890'; }
  else if (row.status === 'present') { label = row.is_late ? 'Late' : 'Present'; bg = 'rgba(45,90,64,0.35)'; bd = colors.success; fg = '#B7EFC5'; if (row.is_late) { bg = 'rgba(163,125,30,0.25)'; bd = colors.warning; fg = '#F1D890'; } }
  else if (row.status === 'half_day') { label = 'Half Day'; bg = 'rgba(163,125,30,0.25)'; bd = colors.warning; fg = '#F1D890'; }
  if (row.missing_punch) { label = 'Missing'; bg = 'rgba(122,40,40,0.25)'; bd = colors.error; fg = '#F1A9A9'; }
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function EmptyBox({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <View style={styles.emptyBox}>
      <Ionicons name={icon} size={44} color={colors.mutedText} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 30, fontWeight: '600',
    fontFamily: fonts.display,
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
  lateMeta: { color: '#F1D890', fontSize: 11, marginTop: 2 },
  eventTime: { color: colors.mutedText, fontSize: 11 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  emptySub: { color: colors.onSurfaceTertiary, fontSize: 12 },
});
