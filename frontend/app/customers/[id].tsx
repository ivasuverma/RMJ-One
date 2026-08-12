import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Customer = { id: string; name: string; mobile: string; address: string };
type Order = { id: string; order_no: string; created_at: string; status: string; item_count?: number };

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ customer: Customer; orders: Order[] }>(`/customers/${id}`);
      setCustomer(res.customer); setOrders(res.orders);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !customer) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="customer-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{customer.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.card}>
          <MetaRow icon="call-outline" label="Mobile" value={customer.mobile || '—'} />
          <MetaRow icon="location-outline" label="Address" value={customer.address || '—'} />
        </View>

        <Text style={styles.section}>Repair History · {orders.length}</Text>
        {orders.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>No repair orders yet</Text></View>
        ) : orders.map((o) => (
          <Pressable key={o.id} onPress={() => router.push(`/repairs/${o.id}` as any)} style={styles.orderRow} testID={`customer-order-${o.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderNo}>{o.order_no}</Text>
              <Text style={styles.orderMeta}>{o.created_at?.slice(0, 10)} · {o.item_count ?? ''} item{o.item_count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[styles.statusBadge, o.status === 'completed' ? styles.statusDone : styles.statusOpen]}>
              <Text style={styles.statusText}>{o.status}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
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
  statusText: { fontSize: 10, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
