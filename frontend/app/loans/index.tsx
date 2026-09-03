import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Loan = {
  id: string; loan_no: string; customer_name: string; customer_mobile: string;
  description: string; weight: number; status: 'active' | 'closed';
  principal: number; principal_balance: number; interest_balance: number; total_outstanding: number;
  interest_months_pending: number;
  estimate_return_date: string | null; overdue: boolean; created_at: string;
};
type Pipe = { active: number; overdue: number; total_outstanding: number; closed_today: number };

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

type StageTone = 'info' | 'bad' | 'good';
const STAGES: { key: string; label: string; tone: StageTone }[] = [
  { key: 'active', label: 'Active', tone: 'info' },
  { key: 'overdue', label: 'Overdue', tone: 'bad' },
  { key: 'closed', label: 'Closed\ntoday', tone: 'good' },
];

export default function GoldLoansScreen() {
  const router = useRouter();
  const { status: routeStatus } = useLocalSearchParams<{ status?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loans, setLoans] = useState<Loan[]>([]);
  const [pipe, setPipe] = useState<Pipe | null>(null);
  const [statusTab, setStatusTab] = useState((routeStatus as string) || 'active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      api.get<Pipe>('/gold-loans/dashboard').then(setPipe).catch(() => {});
      const params = new URLSearchParams();
      if (statusTab !== 'all') params.set('status', statusTab === 'closed' ? 'closed' : statusTab);
      if (query.trim()) params.set('q', query.trim());
      setLoans(await api.get<Loan[]>(`/gold-loans?${params.toString()}`));
    } catch (e: any) { setLoans([]); setError(e?.detail || 'Failed to load gold loans'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [statusTab, query]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toneColor = (t: StageTone) => (t === 'info' ? colors.onInfo : t === 'good' ? colors.onSuccess : colors.onError);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="gold-loans-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Gold Loans</Text>
        <Pressable onPress={() => router.push('/loans/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-loan-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.pipe}>
          <View style={styles.pipeHeadRow}>
            <Text style={styles.pipeHead}>Pipeline</Text>
            <Pressable onPress={() => setStatusTab('all')} testID="loan-tab-all" hitSlop={8}>
              <Text style={[styles.pipeAllLink, statusTab === 'all' && styles.pipeAllLinkActive]}>All</Text>
            </Pressable>
          </View>
          <View style={styles.stages}>
            {STAGES.map((s) => {
              const active = statusTab === s.key;
              const count = pipe ? (s.key === 'active' ? pipe.active : s.key === 'overdue' ? pipe.overdue : pipe.closed_today) : 0;
              return (
                <Pressable key={s.key} style={styles.stage} onPress={() => setStatusTab(s.key)} testID={`loan-stage-${s.key}`}>
                  <View style={styles.stageBar}>
                    <View style={{ height: '100%', borderRadius: 3, backgroundColor: toneColor(s.tone), width: active ? '100%' : count > 0 ? '55%' : '18%', opacity: active ? 1 : 0.65 }} />
                  </View>
                  <Text style={[styles.stageNum, active && { color: toneColor(s.tone) }]}>{count}</Text>
                  <Text style={styles.stageLbl}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {!!pipe && pipe.total_outstanding > 0 && (
            <Text style={styles.outstandingText}>{fmtINR(pipe.total_outstanding)} outstanding across active loans</Text>
          )}
        </View>

        <TextInput
          testID="loan-search" value={query} onChangeText={setQuery} onSubmitEditing={load}
          placeholder="Search by loan no, customer, or mobile" placeholderTextColor={colors.mutedText}
          style={[styles.input, { marginTop: spacing.lg, marginBottom: spacing.md }]}
        />

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} />
        ) : error && loans.length === 0 ? (
          <ErrorState message={error} onRetry={load} testID="loans-error" />
        ) : loans.length === 0 ? (
          <View style={styles.empty}><Ionicons name="diamond-outline" size={34} color={colors.mutedText} /><Text style={styles.emptyText}>No loans here</Text></View>
        ) : loans.map((l) => (
          <Pressable key={l.id} onPress={() => router.push(`/loans/${l.id}` as any)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} testID={`loan-${l.id}`}>
            <View style={styles.cardTop}>
              <View style={styles.iconBox}><Ionicons name="diamond-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cName}>{l.customer_name}</Text>
                <Text style={styles.cMeta} numberOfLines={1}>{l.loan_no} · {l.description}</Text>
                <Text style={styles.cMeta2}>
                  {l.weight.toFixed(3)}g · {fmtINR(l.principal)} loan
                  {l.status === 'active' ? ` · ${fmtINR(l.total_outstanding)} due` : ''}
                  {l.estimate_return_date ? ` · Due ${l.estimate_return_date}` : ''}
                </Text>
              </View>
              <View style={[styles.badge, l.status === 'closed' ? styles.badgeClosed : l.overdue ? styles.badgeOverdue : styles.badgeActive]}>
                <Text style={[styles.badgeText, l.status === 'closed' ? styles.badgeTextClosed : l.overdue ? styles.badgeTextOverdue : styles.badgeTextActive]}>
                  {l.status === 'closed' ? 'Closed' : l.overdue ? 'Overdue' : 'Active'}
                </Text>
              </View>
            </View>

            {l.status === 'active' && (
              <View style={styles.overdueRow}>
                {l.overdue && l.interest_balance > 0 ? (
                  <View>
                    <Text style={styles.overdueLabel}>Interest pending</Text>
                    <Text style={styles.overdueAmount}>
                      {fmtINR(l.interest_balance)}{l.interest_months_pending ? ` · ${l.interest_months_pending} mo` : ''}
                    </Text>
                  </View>
                ) : <View />}
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    const prefill = l.overdue && l.interest_balance > 0 ? `&type=interest&amount=${l.interest_balance}` : '';
                    router.push(`/loans/transact?id=${l.id}${prefill}` as any);
                  }}
                  style={styles.recordBtn}
                  testID={`record-payment-${l.id}`}
                >
                  <Ionicons name="cash-outline" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.recordBtnText}>{l.overdue && l.interest_balance > 0 ? 'Record Interest' : 'Record Payment'}</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  pipe: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  pipeHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  pipeHead: { color: colors.mutedText, fontSize: 13, fontWeight: '600' },
  pipeAllLink: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  pipeAllLinkActive: { color: colors.brandSecondary },
  stages: { flexDirection: 'row', gap: 7 },
  stage: { flex: 1, alignItems: 'center' },
  stageBar: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceTertiary, alignSelf: 'stretch', overflow: 'hidden', marginBottom: 9 },
  stageNum: { color: colors.onSurface, fontSize: 19, fontWeight: '700', letterSpacing: -0.4 },
  stageLbl: { color: colors.mutedText, fontSize: 10.5, textAlign: 'center', marginTop: 2, lineHeight: 13 },
  outstandingText: { color: colors.mutedText, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' },

  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  cMeta2: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm },
  badgeActive: { backgroundColor: colors.brandTertiary },
  badgeClosed: { backgroundColor: colors.success },
  badgeOverdue: { backgroundColor: colors.error },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextActive: { color: colors.brandSecondary },
  badgeTextClosed: { color: colors.onSuccess },
  badgeTextOverdue: { color: colors.onError },

  overdueRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  overdueLabel: { color: colors.mutedText, fontSize: 10 },
  overdueAmount: { color: colors.onError, fontSize: 14, fontWeight: '800', marginTop: 1 },
  recordBtn: {
    flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: colors.brandPrimary,
    borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7,
  },
  recordBtnText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '700' },
});
