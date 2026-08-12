import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
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

const FILTERS: { key: FilterKey; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'received', label: 'Received', icon: 'cube-outline' },
  { key: 'with_karigar', label: 'With Karigar', icon: 'hammer-outline' },
  { key: 'ready', label: 'Pending to Bill', icon: 'pricetag-outline' },
  { key: 'overdue', label: 'Overdue', icon: 'alert-circle-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'checkmark-done-outline' },
];

const FILTER_KEYS = new Set(FILTERS.map((f) => f.key));

export default function RepairOrdersScreen() {
  const router = useRouter();
  const { filter: routeFilter } = useLocalSearchParams<{ filter?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const initialFilter = (routeFilter && FILTER_KEYS.has(routeFilter as FilterKey) ? routeFilter : 'all') as FilterKey;
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (f: FilterKey) => {
    try { setItems(await api.get<Item[]>(`/repair-items?status=${f}`)); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const todayISO = new Date().toISOString().slice(0, 10);
  const activeFilter = FILTERS.find((f) => f.key === filter)!;

  // Bulk issue/receive is only meaningful for a single, unambiguous action —
  // scope it to when the list is filtered down to exactly one bulk-actionable status.
  const bulkAction: 'issue' | 'receive' | null = filter === 'received' ? 'issue' : filter === 'with_karigar' ? 'receive' : null;

  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelected = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };
  const goBulk = () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join(',');
    const path = bulkAction === 'issue' ? '/repairs/item/issue' : '/repairs/item/receive';
    router.push({ pathname: path, params: { itemIds: ids } } as any);
    exitSelect();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repairs-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Repair</Text>
          {!loading && <Text style={styles.subtitle}>{items.length} tag{items.length === 1 ? '' : 's'} · {activeFilter.label}</Text>}
        </View>
        {selectMode ? (
          <Pressable onPress={exitSelect} style={styles.iconBtn} testID="cancel-select-btn" hitSlop={12}>
            <Ionicons name="close" size={20} color={colors.onSurface} />
          </Pressable>
        ) : bulkAction ? (
          <Pressable onPress={() => setSelectMode(true)} style={[styles.iconBtn, styles.selectBtn]} testID="select-mode-btn" hitSlop={12}>
            <Ionicons name="checkbox-outline" size={20} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.push('/repairs/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-repair-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => { setLoading(true); setFilter(f.key); exitSelect(); }}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            testID={`filter-${f.key}`}
          >
            <Ionicons name={f.icon} size={13} color={filter === f.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: selectMode ? 90 : spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(filter); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="construct-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No repairs found for this filter</Text></View>
        ) : items.map((i) => {
          const isOverdue = !!i.due_date && i.due_date < todayISO && i.status !== 'delivered';
          const sc = repairStatusColors(i.status, colors);
          const checked = selectedIds.has(i.id);
          return (
            <Pressable
              key={i.id}
              onPress={() => (selectMode ? toggleSelected(i.id) : router.push(`/repairs/item/${i.id}` as any))}
              style={[styles.card, selectMode && checked && styles.cardSelected]}
              testID={`item-${i.id}`}
            >
              <View style={styles.cardTopRow}>
                {selectMode ? (
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Ionicons name="checkmark" size={14} color={colors.onBrandPrimary} />}
                  </View>
                ) : (
                  <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={16} color={colors.brandSecondary} /></View>
                )}
                <Text style={styles.cName} numberOfLines={1}>{i.item_code} · {i.customer_name}</Text>
                <View style={[styles.statusBadge, isOverdue ? { backgroundColor: colors.error, borderColor: colors.onError } : { backgroundColor: sc.bg, borderColor: sc.border }]}>
                  <Text style={[styles.statusText, isOverdue ? { color: colors.onError } : { color: sc.fg }]}>{isOverdue ? 'Overdue' : REPAIR_STATUS_LABEL[i.status]}</Text>
                </View>
              </View>

              <Text style={styles.cDesc} numberOfLines={1}>{i.description}</Text>

              <View style={styles.pillRow}>
                <View style={styles.pill}>
                  <Ionicons name="scale-outline" size={11} color={colors.onSurfaceTertiary} />
                  <Text style={styles.pillText}>{i.gross_weight.toFixed(3)}g</Text>
                </View>
                {!!i.karigar_name && (
                  <View style={styles.pill}>
                    <Ionicons name="hammer-outline" size={11} color={colors.onSurfaceTertiary} />
                    <Text style={styles.pillText}>{i.karigar_name}</Text>
                  </View>
                )}
                {!!i.due_date && (
                  <View style={[styles.pill, isOverdue && styles.pillDanger]}>
                    <Ionicons name="calendar-outline" size={11} color={isOverdue ? colors.onError : colors.onSurfaceTertiary} />
                    <Text style={[styles.pillText, isOverdue && { color: colors.onError, fontWeight: '700' }]}>Due {i.due_date}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {selectMode && bulkAction && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkBarText}>{selectedIds.size} selected</Text>
          <Pressable onPress={goBulk} disabled={selectedIds.size === 0} style={[styles.bulkBtn, selectedIds.size === 0 && { opacity: 0.5 }]} testID="bulk-action-btn">
            <Ionicons name={bulkAction === 'issue' ? 'arrow-redo-outline' : 'arrow-undo-outline'} size={16} color={colors.onBrandPrimary} />
            <Text style={styles.bulkBtnText}>{bulkAction === 'issue' ? 'Issue' : 'Receive'} {selectedIds.size || ''} Tag{selectedIds.size === 1 ? '' : 's'}</Text>
          </Pressable>
        </View>
      )}
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
  selectBtn: { marginLeft: spacing.sm },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  subtitle: { color: colors.mutedText, fontSize: 11, marginTop: 2 },

  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 2 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.onBrandPrimary },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  iconBox: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { flex: 1, color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cDesc: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 6, marginLeft: 38 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, marginLeft: 38 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4,
  },
  pillDanger: { backgroundColor: colors.error },
  pillText: { color: colors.onSurfaceTertiary, fontSize: 11 },

  bulkBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  bulkBarText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  bulkBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
});
