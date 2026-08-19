import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/src/api/client';
import { REPAIR_STATUS_LABEL, RepairItemStatus } from '@/src/utils/repairStatus';
import { todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: RepairItemStatus; karigar_name: string | null;
  gross_weight: number; due_date: string | null; created_at: string; created_by?: string;
};
type Pipe = { received: number; with_karigar: number; ready: number; overdue: number; total_open?: number };

type FilterKey = 'all' | RepairItemStatus | 'overdue';
const FILTER_KEYS = new Set<FilterKey>(['all', 'received', 'with_karigar', 'ready', 'overdue', 'pending_delivery', 'delivered']);

// The four pipeline stages, in flow order, each with the tone used for its
// little progress bar + count. Tapping a stage filters the list below.
const STAGES: { key: FilterKey; label: string; tone: 'info' | 'warn' | 'good' | 'bad'; countKey: keyof Pipe }[] = [
  { key: 'received', label: 'Received', tone: 'info', countKey: 'received' },
  { key: 'with_karigar', label: 'With\nkarigar', tone: 'warn', countKey: 'with_karigar' },
  { key: 'ready', label: 'Ready\nto bill', tone: 'good', countKey: 'ready' },
  { key: 'overdue', label: 'Overdue', tone: 'bad', countKey: 'overdue' },
];

export default function RepairOrdersScreen() {
  const router = useRouter();
  const { filter: routeFilter } = useLocalSearchParams<{ filter?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const [pipe, setPipe] = useState<Pipe | null>(null);
  const initialFilter = (routeFilter && FILTER_KEYS.has(routeFilter as FilterKey) ? routeFilter : 'received') as FilterKey;
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const triedFallbackRef = useRef(!!routeFilter);

  const load = useCallback(async (f: FilterKey) => {
    try {
      api.get<Pipe>('/repairs/dashboard').then(setPipe).catch(() => {});
      const res = await api.get<Item[]>(`/repair-items?status=${f}`);
      if (f === 'received' && res.length === 0 && !triedFallbackRef.current) {
        triedFallbackRef.current = true;
        setFilter('with_karigar');
        return;
      }
      setItems(res);
    } catch (_e) { setItems([]); }
    finally { setRefreshing(false); setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const todayISO = todayIST();
  const totalOpen = pipe ? (pipe.received + pipe.with_karigar + pipe.ready) : items.length;
  const toneColor = (t: string) => (t === 'info' ? colors.onInfo : t === 'warn' ? colors.onWarning : t === 'good' ? colors.onSuccess : colors.onError);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repairs-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(filter); }} tintColor={colors.brandPrimary} />}
      >
        <Pressable onPress={() => router.back()} style={styles.backRow} testID="back-btn" hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
          <Text style={styles.backText}>Work</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Repairs</Text>
            <Text style={styles.sub}>Create, track and bill — all in one place.</Text>
          </View>
          <Pressable onPress={() => router.push('/repairs/new' as any)} style={styles.addBtn} testID="new-repair-btn" hitSlop={10}>
            <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        {/* Pipeline bar */}
        <View style={styles.pipe}>
          <Text style={styles.pipeHead}>Pipeline · {totalOpen} open</Text>
          <View style={styles.stages}>
            {STAGES.map((s) => {
              const active = filter === s.key;
              const count = pipe ? (pipe[s.countKey] as number) : 0;
              return (
                <Pressable key={s.key} style={styles.stage} onPress={() => { setLoading(true); setFilter(s.key); }} testID={`stage-${s.key}`}>
                  <View style={styles.stageBar}>
                    <View style={{ height: '100%', borderRadius: 3, backgroundColor: toneColor(s.tone), width: active ? '100%' : count > 0 ? '55%' : '18%', opacity: active ? 1 : 0.65 }} />
                  </View>
                  <Text style={[styles.stageNum, active && { color: toneColor(s.tone) }]}>{count}</Text>
                  <Text style={styles.stageLbl}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Items</Text>
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="construct-outline" size={34} color={colors.mutedText} /><Text style={styles.emptyText}>No repairs in this stage</Text></View>
        ) : items.map((i) => {
          const isOverdue = !!i.due_date && i.due_date < todayISO && i.status !== 'delivered' && i.status !== 'pending_delivery';
          const pill = isOverdue ? { label: 'Overdue', tone: 'bad' } : i.status === 'ready' ? { label: 'Ready', tone: 'good' } : i.status === 'with_karigar' ? { label: 'Karigar', tone: 'warn' } : i.status === 'received' ? { label: 'Received', tone: 'info' } : { label: REPAIR_STATUS_LABEL[i.status], tone: 'info' };
          const pillFg = toneColor(pill.tone === 'bad' ? 'bad' : pill.tone === 'good' ? 'good' : pill.tone === 'warn' ? 'warn' : 'info');
          const pillBg = pill.tone === 'bad' ? colors.error : pill.tone === 'good' ? colors.success : pill.tone === 'warn' ? colors.warning : colors.info;
          const canBill = i.status === 'ready';
          return (
            <View key={i.id} style={styles.item} testID={`item-${i.id}`}>
              <View style={styles.itemTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.code}>{i.item_code}</Text>
                  <Text style={styles.cust} numberOfLines={1}>{i.customer_name} — {i.description}</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: pillBg }]}><Text style={[styles.pillText, { color: pillFg }]}>{pill.label}</Text></View>
              </View>
              <View style={styles.actRow}>
                {canBill && (
                  <Pressable onPress={() => router.push(`/repairs/bill?itemId=${i.id}` as any)} style={[styles.btn, styles.btnPri]} testID={`bill-${i.id}`}>
                    <Text style={styles.btnPriText}>Create bill</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => router.push(`/repairs/item/${i.id}` as any)} style={[styles.btn, styles.btnGhost]} testID={`open-${i.id}`}>
                  <Text style={styles.btnGhostText}>{canBill ? 'Open' : 'Open item'}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '500' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  h1: { color: colors.onSurface, fontSize: 32, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },

  pipe: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.lg,
  },
  pipeHead: { color: colors.mutedText, fontSize: 13, fontWeight: '600', marginBottom: 13 },
  stages: { flexDirection: 'row', gap: 7 },
  stage: { flex: 1, alignItems: 'center' },
  stageBar: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceTertiary, alignSelf: 'stretch', overflow: 'hidden', marginBottom: 9 },
  stageNum: { color: colors.onSurface, fontSize: 19, fontWeight: '700', letterSpacing: -0.4 },
  stageLbl: { color: colors.mutedText, fontSize: 10.5, textAlign: 'center', marginTop: 2, lineHeight: 13 },

  sectionLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },

  item: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: 10,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  code: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  cust: { color: colors.mutedText, fontSize: 13, marginTop: 1 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  actRow: { flexDirection: 'row', gap: 9, marginTop: 13 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11 },
  btnPri: { backgroundColor: colors.brandPrimary },
  btnPriText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },
  btnGhost: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.borderStrong },
  btnGhostText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
});
