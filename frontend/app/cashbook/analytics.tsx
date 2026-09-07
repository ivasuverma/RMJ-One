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

type Period = 'day' | 'week' | 'month';
type TypeAmount = { category: string; amount: number };
type TrendPoint = { date: string; received: number; paid: number };
type Analytics = {
  period: Period; start_date: string; end_date: string;
  total_received: number; total_paid: number;
  by_type_received: TypeAmount[]; by_type_paid: TypeAmount[];
  trend: TrendPoint[];
};

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' },
];

// Fixed categorical palette for the donut/legend — cycles if there are more
// types than colors. Deliberately separate from the app's semantic
// success/error (received/paid) colors used elsewhere on this screen.
const PALETTE = ['#A9812F', '#5B8DB8', '#8A6BB0', '#4E9E82', '#C0764A', '#B0567A', '#5E7A9E', '#9E9247'];

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
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

export default function CashbookAnalyticsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  // Owner-only page — the backend already 403s anyone else, but bounce
  // straight back to the regular Cash Book screen instead of surfacing an
  // error, since owner/admin/accountant/employee all reach this same route
  // via the Dashboard's Cash Book tile.
  useFocusEffect(useCallback(() => {
    if (user && user.role !== 'owner') router.replace('/cashbook');
  }, [user, router]));

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<Analytics>(`/cashbook/analytics?period=${period}&date=${date}`)); }
    catch (_e) { setData(null); }
    finally { setLoading(false); }
  }, [period, date]);
  useFocusEffect(useCallback(() => { if (user?.role === 'owner') load(); }, [load, user]));

  if (!user || user.role !== 'owner') return null;

  const net = (data?.total_received || 0) - (data?.total_paid || 0);
  const maxTrend = Math.max(1, ...(data?.trend || []).flatMap((t) => [t.received, t.paid]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cashbook-analytics-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Cash Book Analytics</Text>
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
              <Text style={styles.summaryLabel}>Received</Text>
              <Text style={[styles.summaryValue, { color: colors.onSuccess }]}>{fmtINR(data.total_received)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Paid</Text>
              <Text style={[styles.summaryValue, { color: colors.onError }]}>{fmtINR(data.total_paid)}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Net</Text>
              <Text style={[styles.summaryValue, { color: net >= 0 ? colors.onSuccess : colors.onError }]}>{fmtINR(net)}</Text>
            </View>
          </View>

          {period !== 'day' && data.trend.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Trend</Text>
              <View style={styles.trendCard}>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.onSuccess }]} /><Text style={styles.legendText}>Received</Text></View>
                  <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.onError }]} /><Text style={styles.legendText}>Paid</Text></View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.barsRow}>
                    {data.trend.map((t) => {
                      const d = new Date(t.date + 'T00:00:00');
                      const label = period === 'week' ? DAY_SHORT[d.getDay() === 0 ? 6 : d.getDay() - 1] : String(d.getDate());
                      return (
                        <View key={t.date} style={styles.barCol}>
                          <View style={styles.barPair}>
                            <View style={[styles.bar, { height: Math.max(2, (t.received / maxTrend) * 90), backgroundColor: colors.onSuccess }]} />
                            <View style={[styles.bar, { height: Math.max(2, (t.paid / maxTrend) * 90), backgroundColor: colors.onError }]} />
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

          <Text style={styles.sectionLabel}>Received by Type</Text>
          <TypeBreakdown data={data.by_type_received} total={data.total_received} colors={colors} styles={styles} />

          <Text style={styles.sectionLabel}>Paid by Type</Text>
          <TypeBreakdown data={data.by_type_paid} total={data.total_paid} colors={colors} styles={styles} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TypeBreakdown({ data, total, colors, styles }: { data: TypeAmount[]; total: number; colors: ThemeColors; styles: any }) {
  if (data.length === 0 || total <= 0) {
    return <Text style={styles.empty}>No entries this period.</Text>;
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
            const frac = d.amount / total;
            const dash = frac * circumference;
            const offset = -cumulative;
            cumulative += dash;
            return (
              <Circle
                key={d.category}
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
          <View key={d.category} style={styles.legendListRow} testID={`analytics-legend-${d.category}`}>
            <View style={[styles.legendDot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={styles.legendListLabel} numberOfLines={1}>{d.category}</Text>
            <Text style={styles.legendListPct}>{Math.round((d.amount / total) * 100)}%</Text>
            <Text style={styles.legendListValue}>{fmtINR(d.amount)}</Text>
          </View>
        ))}
      </View>
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
  summaryValue: { fontSize: 15, fontWeight: '800' },

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
  legendListValue: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700', width: 88, textAlign: 'right' },
});
