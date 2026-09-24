import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Row = {
  id: string; date: string; label: string; note: string; by?: string; fine_delta: number; amount_delta: number; held: number; due: number;
  weight?: number | null; amount?: number | null;
};
type Job = {
  job: { kind: 'repair' | 'sample'; code: string; description: string; status?: string; customer: string; karigar: string; purity?: number | null; weight?: number | null; created_at?: string; delivered_at?: string };
  gold: { issued_fine: number; returned_fine: number; declared_loss_fine: number; absorbed_loss_fine: number; with_karigar_fine: number };
  money: { labour_payable: number; paid_to_karigar: number; owed_to_karigar: number };
  bill: { billed: number; previous_balance: number; income: number; labour_charge: number; material_adjustment: number; extra_charges: number } | null;
  result: number | null;
  entries: Row[];
};

const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const g = (n: number) => `${n.toFixed(3)}g`;

// One job (a repair tag or a Stock In/Out sample) on one page: what went out and came back, what it cost, what was
// billed, and what the shop made or lost on it. Fine gold and money are never netted together — gold loss is shown
// as gold. Cancelled entries are not counted. (Payments are entered in the Cash Book, so they aren't here.)
export default function JobStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setError(''); setData(await api.get<Job>(`/jobs/${id}`)); }
    catch (e: any) { setError(e?.detail || 'Could not load this job'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
      <Text style={styles.title} numberOfLines={1}>{data ? `${data.job.code} · Job statement` : 'Job statement'}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
  if (loading || !data) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        {header}
        {loading ? <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
          : <View style={{ padding: spacing.lg }}><ErrorState message={error || 'Job not found'} onRetry={load} testID="job-error" /></View>}
      </SafeAreaView>
    );
  }
  const { job, gold, money, bill, result } = data;
  const loss = gold.declared_loss_fine + gold.absorbed_loss_fine;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="job-statement-screen">
      {header}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{job.description || job.code}</Text>
          <Text style={styles.meta}>
            {[job.kind === 'repair' ? 'Repair' : 'Sample', job.status?.replace(/_/g, ' '), job.purity ? `${job.purity}%` : null, job.weight ? g(job.weight) : null].filter(Boolean).join(' · ')}
          </Text>
          {job.customer ? <Text style={styles.meta}>Customer: {job.customer}</Text> : null}
          {job.karigar ? <Text style={styles.meta}>Karigar: {job.karigar}</Text> : null}
          {job.created_at ? <Text style={styles.meta}>Started {istDate(job.created_at)}{job.delivered_at ? ` · finished ${istDate(job.delivered_at)}` : ''}</Text> : null}
        </View>

        <Text style={styles.section}>Gold (fine)</Text>
        <View style={styles.tiles}>
          <Tile styles={styles} value={g(gold.issued_fine)} label="Issued" />
          <Tile styles={styles} value={g(gold.returned_fine)} label="Received back" />
          <Tile styles={styles} value={g(gold.with_karigar_fine)} label="Still with karigar" warn={Math.abs(gold.with_karigar_fine) > 0.001} />
        </View>
        {loss > 0.0005 ? (
          <Text style={styles.note} testID="job-loss">Loss: {g(loss)}{gold.absorbed_loss_fine > 0 ? ` (${g(gold.absorbed_loss_fine)} absorbed by the shop)` : ''} — the shop bears it. Shown as gold, not converted to money.</Text>
        ) : null}

        <Text style={styles.section}>Money</Text>
        <View style={styles.tiles}>
          <Tile styles={styles} value={inr(money.labour_payable)} label="Karigar labour" />
          <Tile styles={styles} value={inr(money.paid_to_karigar)} label="Paid to karigar" />
          <Tile styles={styles} value={`${inr(money.owed_to_karigar)}${money.owed_to_karigar < -0.5 ? ' Cr' : ''}`} label={money.owed_to_karigar >= 0 ? 'Owed to karigar' : 'Karigar owes'} warn={Math.abs(money.owed_to_karigar) > 0.5} />
        </View>

        {bill ? (
          <View style={styles.card} testID="job-bill">
            <Text style={styles.cardTitle}>Bill to the customer</Text>
            <Line styles={styles} k="Labour charge" v={inr(bill.labour_charge)} />
            {bill.material_adjustment ? <Line styles={styles} k="Material adjustment" v={inr(bill.material_adjustment)} /> : null}
            {bill.extra_charges ? <Line styles={styles} k="Extra charges" v={inr(bill.extra_charges)} /> : null}
            {bill.previous_balance ? <Line styles={styles} k="Earlier balance carried" v={inr(bill.previous_balance)} /> : null}
            <Line styles={styles} k="Billed" v={inr(bill.billed)} strong />
            <Line styles={styles} k="This job's income" v={inr(bill.income)} />
            <Line styles={styles} k="less karigar labour" v={`− ${inr(money.labour_payable)}`} />
            <View style={styles.divider} />
            <Line styles={styles} k="Result on this job" v={`${(result ?? 0) < 0 ? '−' : ''}${inr(result ?? 0)}`} strong tone={(result ?? 0) < 0 ? 'bad' : 'good'} />
            <Text style={styles.note}>Payments are recorded in the Cash Book, not in the repair module.</Text>
          </View>
        ) : null}

        <Text style={styles.section}>Entries · {data.entries.length}</Text>
        {data.entries.length === 0 ? <Text style={styles.meta}>No gold or labour entries for this job.</Text> : null}
        {data.entries.map((e) => (
          <View key={e.id} style={styles.entry} testID={`job-entry-${e.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.entryTitle}>{e.label}</Text>
              <Text style={styles.entryMeta}>{e.note || '—'} · {istDate(e.date)}{e.by ? ` · ${e.by}` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {Math.abs(e.fine_delta) >= 0.0005 ? <Text style={styles.entryVal}>{e.fine_delta > 0 ? '+' : '−'}{Math.abs(e.fine_delta).toFixed(3)}g</Text> : null}
              {Math.abs(e.amount_delta) >= 0.005 ? <Text style={styles.entryVal}>{e.amount_delta > 0 ? '+' : '−'}{inr(e.amount_delta)}</Text> : null}
              <Text style={styles.entryRun}>held {e.held.toFixed(3)}g</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ styles, value, label, warn }: { styles: any; value: string; label: string; warn?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, warn && styles.tileWarn]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}
function Line({ styles, k, v, strong, tone }: { styles: any; k: string; v: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineK, strong && { fontWeight: '800' }]}>{k}</Text>
      <Text style={[styles.lineV, strong && { fontWeight: '800' }, tone === 'bad' && styles.bad, tone === 'good' && styles.good]}>{v}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: 4 },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  meta: { color: colors.mutedText, fontSize: 12.5 },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  tileValue: { color: colors.onSurface, fontSize: 17, fontWeight: '800' },
  tileWarn: { color: colors.onWarning },
  tileLabel: { color: colors.mutedText, fontSize: 11, marginTop: 3, textAlign: 'center' },
  note: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  lineK: { color: colors.mutedText, fontSize: 13 },
  lineV: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  good: { color: colors.onSuccess }, bad: { color: colors.onError },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: 8 },
  entryTitle: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  entryMeta: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  entryVal: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryRun: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
});
