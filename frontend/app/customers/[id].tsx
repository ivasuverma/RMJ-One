import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';
import { StatementSheet } from '@/src/components/StatementSheet';

type Customer = { id: string; name: string; mobile: string; address: string };
type Order = { id: string; order_no: string; created_at: string; status: string; item_count?: number };
type Bill = { id: string; item_code: string; description: string; status: string; billed_amount: number | null; gross_weight: number | null; created_at: string };

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billedTotal, setBilledTotal] = useState(0);
  const [stmtOpen, setStmtOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get<{ customer: Customer; orders: Order[]; bills?: Bill[]; billed_total?: number }>(`/customers/${id}`);
      setCustomer(res.customer); setOrders(res.orders); setBills(res.bills || []); setBilledTotal(res.billed_total || 0);
    } catch (e: any) { setError(e?.detail || 'Failed to load customer'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !customer) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <View style={{ padding: spacing.lg }}><ErrorState message={error || 'Customer not found'} onRetry={load} testID="customer-detail-error" /></View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="customer-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{customer.name}</Text>
        <Pressable onPress={() => setStmtOpen(true)} style={styles.iconBtn} testID="customer-statement-btn" hitSlop={12}>
          <Ionicons name="document-text-outline" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.card}>
          <MetaRow icon="call-outline" label="Mobile" value={customer.mobile || '—'} />
          <MetaRow icon="location-outline" label="Address" value={customer.address || '—'} />
        </View>

        <Text style={styles.section}>Billed</Text>
        <View style={styles.card} testID="customer-billed">
          <MetaRow icon="receipt-outline" label="Total billed" value={`₹${billedTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
          <MetaRow icon="list-outline" label="Bills" value={String(bills.filter((b) => b.billed_amount).length)} />
        </View>
        {bills.filter((b) => b.billed_amount).map((b) => (
          <Pressable key={b.id} onPress={() => router.push(`/jobs/${b.id}` as any)} style={styles.orderRow} testID={`customer-bill-${b.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>{b.item_code} · {b.description}</Text>
              <Text style={styles.orderMeta}>{istDate(b.created_at)} · {b.status.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={styles.orderNo}>₹{Number(b.billed_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Text>
          </Pressable>
        ))}
        <Text style={styles.hint}>What the customer pays is entered in the Cash Book, not here.</Text>

        <Text style={styles.section}>Repair History · {orders.length}</Text>
        {orders.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>No repair orders yet</Text></View>
        ) : orders.map((o) => (
          <Pressable key={o.id} onPress={() => router.push(`/repairs/${o.id}` as any)} style={styles.orderRow} testID={`customer-order-${o.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>{o.order_no}</Text>
              <Text style={styles.orderMeta}>{istDate(o.created_at)} · {o.item_count ?? ''} item{o.item_count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[styles.statusBadge, o.status === 'completed' ? styles.statusDone : styles.statusOpen]}>
              <Text style={styles.statusText}>{o.status}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <StatementSheet visible={stmtOpen} onClose={() => setStmtOpen(false)} path={`/customers/${id}/statement/pdf`} title={`Statement — ${customer.name}`} filename={`customer-${customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
    </SafeAreaView>
  );
}

function MetaRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color={colors.brandSecondary} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  metaLabel: { color: colors.mutedText, fontSize: 12, width: 70 },
  metaValue: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.mutedText, fontSize: 12, marginTop: 4, marginBottom: spacing.sm },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  orderNo: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  orderMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.brandTertiary, borderColor: colors.brand },
  statusDone: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
