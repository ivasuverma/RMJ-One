import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Circle, G } from 'react-native-svg';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { localDateStr, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Owner-only attendance dashboard — same day/week/month shape as Cash Book
// Analytics: present/late/absent breakdown, a daily trend, and who's most
// often late or absent. Counts come from GET /attendance/analytics, which
// resolves each employee-day with the same logic the live Attendance screen
// and Payroll use, so these numbers always agree with those.
type Period = 'day' | 'week' | 'month';
type StatusCount = { status: string; count: number };
type TrendPoint = { date: string; present: number; absent: number };
type NameCount = { employee_id: string; name: string; count: number };
type Analytics = {
  period: Period; start_date: string; end_date: string;
  counts: Record<string, number>;
  by_status: StatusCount[];
  trend: TrendPoint[];
  top_late: NameCount[];
  top_absent: NameCount[];
};

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' },
];
const STATUS_LABEL: Record<string, string> = {
  present: 'Present', late: 'Late', half_day: 'Half Day', absent: 'Absent', missing_punch: 'Missing Punch', leave: 'Leave',
};
const PALETTE = ['#4E9E82', '#C0764A', '#A9812F', '#B0567A', '#5B8DB8', '#5E7A9E'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtRangeLabel(period: Period, start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (period === 'day') return `${s.getDate()} ${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()}`;
  if (period === 'month') return `${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()}`;
  const sameMonth = s.getMonth() === e.getMonth();
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()}`
    : `${s.getDate()} ${MONTH_NAMES[s.getMonth()]} – ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${s.getFullYear()}`;
}

function shiftDate(iso: string, period: Period, dir: 1 | -1): string {
  const d = new Date(iso + 'T00:00:00');
  if (period === 'month') d.setMonth(d.getMonth() + dir);
  else d.setDate(d.getDate() + dir * (period === 'week' ? 7 : 1));
  return localDateStr(d);
}

export default function AttendanceAnalyticsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  // Owner-only page — the backend already 403s anyone else, but bounce
  // straight back to the regular Attendance screen instead of surfacing an
  // error, since owner/admin/accountant/employee all reach this same route
  // via the Dashboard's Attendance tile.
  useFocusEffect(useCallback(() => {
    if (user && user.role !== 'owner') router.replace('/(tabs)/attendance');
  }, [user, router]));

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<Analytics>(`/attendance/analytics?period=${period}&date=${date}`)); }
    catch (_e) { setData(null); }
    finally { setLoading(false); }
  }, [period, date]);
  useFocusEffect(useCallback(() => { if (user?.role === 'owner') load(); }, [load, user]));

  if (!user || user.role !== 'owner') return null;

  const totalMarked = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const maxTrend = Math.max(1, ...(data?.trend || []).flatMap((t) => [t.present, t.absent]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="attendance-analytics-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Attendance Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <Pressable key={p.key} onPress={() => setPeriod(p.key)} style={[styles.periodBtn, period === p.key && styles.periodBtnActive]} testID={`analytics-period-${p.key}`}>
            <Text style={[styles.periodBtnText, period === p.key && styles.periodBtnTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.dateNav}>
        <Pressable onPress={() => setDate((d) => shiftDate(d, period, -1))} style={styles.navBtn} testID="analytics-prev" hitSlop={10}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.dateLabel} testID="analytics-range-label">
          {data ? fmtRangeLabel(period, data.start_date, data.end_date) : '—'}
        </Text>
        <Pressable onPress={() => setDate((d) => shiftDate(d, period, 1))} style={styles.navBtn} testID="analytics-next" hitSlop={10}>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} />
      ) : !data ? (
        <Text style={styles.empty}>Couldn&apos;t load this period.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Present</Text>
              <Text style={[styles.summaryValue, { color: colors.onSuccess }]}>{data.counts.present || 0}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Late</Text>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>{data.counts.late || 0}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Absent</Text>
              <Text style={[styles.summaryValue, { color: colors.onError }]}>{data.counts.absent || 0}</Text>
            </View>
          </View>

          {period !== 'day' && data.trend.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Trend</Text>
              <View style={styles.trendCard}>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.onSuccess }]} /><Text style={styles.legendText}>Present</Text></View>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.onError }]} /><Text style={styles.legendText}>Absent</Text></View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.barsRow}>
                    {data.trend.map((t) => {
                      const d = new Date(t.date + 'T00:00:00');
                      const label = period === 'week' ? DAY_SHORT[d.getDay() === 0 ? 6 : d.getDay() - 1] : String(d.getDate());
                      return (
                        <View key={t.date} style={styles.barCol}>
                          <View style={styles.barPair}>
                            <View style={[styles.bar, { height: Math.max(2, (t.present / maxTrend) * 90), backgroundColor: colors.onSuccess }]} />
                            <View style={[styles.bar, { height: Math.max(2, (t.absent / maxTrend) * 90), backgroundColor: colors.onError }]} />
                          </View>
                          <Text style={styles.barLabel}>{label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>Breakdown</Text>
          <StatusBreakdown data={data.by_status} total={totalMarked} colors={colors} styles={styles} />

          {data.top_late.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Most Late</Text>
              <Leaderboard rows={data.top_late} tone={colors.onWarning} colors={colors} styles={styles} testIDPrefix="top-late" />
            </>
          )}
          {data.top_absent.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Most Absent</Text>
              <Leaderboard rows={data.top_absent} tone={colors.onError} colors={colors} styles={styles} testIDPrefix="top-absent" />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatusBreakdown({ data, total, colors, styles }: { data: StatusCount[]; total: number; colors: ThemeColors; styles: any }) {
  if (data.length === 0 || total <= 0) {
    return <Text style={styles.empty}>No attendance recorded this period.</Text>;
  }
  const size = 140;
  const stroke = 24;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;
  return (
    <View style={styles.breakdownCard}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          {data.map((d, i) => {
            const frac = d.count / total;
            const dash = frac * circumference;
            const offset = -cumulative;
            cumulative += dash;
            return (
              <Circle
                key={d.status}
                cx={size / 2} cy={size / 2} r={radius}
                stroke={PALETTE[i % PALETTE.length]} strokeWidth={stroke} fill="none"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </G>
      </Svg>
      <View style={styles.legendList}>
        {data.map((d, i) => (
          <View key={d.status} style={styles.legendListRow} testID={`analytics-legend-${d.status}`}>
            <View style={[styles.legendDot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={styles.legendListLabel} numberOfLines={1}>{STATUS_LABEL[d.status] || d.status}</Text>
            <Text style={styles.legendListPct}>{Math.round((d.count / total) * 100)}%</Text>
            <Text style={styles.legendListValue}>{d.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Leaderboard({ rows, tone, colors, styles, testIDPrefix }: { rows: NameCount[]; tone: string; colors: ThemeColors; styles: any; testIDPrefix: string }) {
  return (
    <View style={styles.leaderCard}>
      {rows.map((r, i) => (
        <View key={r.employee_id} style={[styles.leaderRow, i === rows.length - 1 && { borderBottomWidth: 0 }]} testID={`${testIDPrefix}-${r.employee_id}`}>
          <Text style={styles.leaderName} numberOfLines={1}>{r.name}</Text>
          <Text style={[styles.leaderCount, { color: tone }]}>{r.count}</Text>
        </View>
      ))}
    </View>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 17, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },

  periodRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  periodBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  periodBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  periodBtnText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  periodBtnTextActive: { color: colors.onBrandPrimary },

  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.md },
  navBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  dateLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '700', minWidth: 160, textAlign: 'center' },

  empty: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center', gap: 4,
  },
  summaryLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryValue: { fontSize: 20, fontWeight: '800' },

  sectionLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.sm },

  trendCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  legendRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingBottom: 4, minWidth: '100%' },
  barCol: { alignItems: 'center', gap: 6, width: 30 },
  barPair: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 90 },
  bar: { width: 8, borderRadius: 3 },
  barLabel: { color: colors.mutedText, fontSize: 9.5 },

  breakdownCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg, alignItems: 'center', gap: spacing.md,
  },
  legendList: { alignSelf: 'stretch', gap: 8 },
  legendListRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendListLabel: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  legendListPct: { color: colors.mutedText, fontSize: 11.5, width: 36, textAlign: 'right' },
  legendListValue: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700', width: 44, textAlign: 'right' },

  leaderCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.lg, overflow: 'hidden',
  },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  leaderName: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  leaderCount: { fontSize: 15, fontWeight: '800' },
});
