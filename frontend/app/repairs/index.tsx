import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { REPAIR_STATUS_LABEL, repairStatusColors, RepairItemStatus } from '@/src/utils/repairStatus';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: RepairItemStatus; karigar_name: string | null;
  gross_weight: number; due_date: string | null; created_at: string; created_by?: string;
};

type FilterKey = 'all' | RepairItemStatus | 'overdue';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'received', label: 'Received' },
  { key: 'with_karigar', label: 'With Karigar' },
  { key: 'ready', label: 'Pending to Bill' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'delivered', label: 'Delivered' },
];

export default function RepairOrdersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: FilterKey) => {
    try { setItems(await api.get<Item[]>(`/repair-items?status=${f}`)); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repairs-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>In/Out Repairs</Text>
        <Pressable onPress={() => router.push('/repairs/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-repair-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => { setLoading(true); setFilter(f.key); }}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            testID={`filter-${f.key}`}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(filter); }} tintColor={colors.brandPrimary} />}
      >
        {!loading && items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="construct-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No repairs found for this filter</Text></View>
        ) : items.map((i) => {
          const isOverdue = !!i.due_date && i.due_date < todayISO && i.status !== 'delivered';
          const sc = repairStatusColors(i.status, colors);
          return (
            <Pressable key={i.id} onPress={() => router.push(`/repairs/item/${i.id}` as any)} style={styles.card} testID={`item-${i.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{i.item_code} · {i.customer_name}</Text>
                <Text style={styles.cMeta}>{i.description} · {i.gross_weight.toFixed(3)}g{i.karigar_name ? ` · ${i.karigar_name}` : ''}</Text>
                {i.due_date && <Text style={[styles.cMeta, isOverdue && { color: colors.onError, fontWeight: '700' }]}>Due {i.due_date}{isOverdue ? ' · overdue' : ''}</Text>}
              </View>
              <View style={[styles.statusBadge, isOverdue ? { backgroundColor: colors.error, borderColor: colors.onError } : { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[styles.statusText, isOverdue ? { color: colors.onError } : { color: sc.fg }]}>{isOverdue ? 'Overdue' : REPAIR_STATUS_LABEL[i.status]}</Text>
              </View>
            </Pressable>
          );
        })}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },

  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.onBrandPrimary },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
});
