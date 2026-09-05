import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/src/api/client';
import { REPAIR_STATUS_LABEL, RepairItemStatus } from '@/src/utils/repairStatus';
import { todayIST, istDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: RepairItemStatus; karigar_name: string | null; repair_type?: string;
  gross_weight: number; due_date: string | null; created_at: string; created_by?: string;
  issued_by?: string | null; delivered_by?: string | null; delivered_at?: string | null;
};
type Pipe = { received: number; with_karigar: number; ready: number; pending_delivery: number; delivered_today: number; overdue: number };

type StageTone = 'info' | 'warn' | 'good' | 'brand' | 'muted' | 'bad';
type FilterKey = 'all' | RepairItemStatus | 'overdue';
const FILTER_KEYS = new Set<FilterKey>(['all', 'received', 'with_karigar', 'ready', 'overdue', 'pending_delivery', 'delivered']);

// The full repair lifecycle, in flow order — new repair → pending issue →
// pending receive → to bill → pending delivery → delivered/closed. Each stage
// is tappable to filter the list to exactly that status. "New repair" is the +
// action (top-right), so the pipeline shows the five live states after intake.
const STAGES: { key: FilterKey; label: string; tone: StageTone; countKey: keyof Pipe }[] = [
  { key: 'received', label: 'Pending\nissue', tone: 'info', countKey: 'received' },
  { key: 'with_karigar', label: 'Pending\nreceive', tone: 'warn', countKey: 'with_karigar' },
  { key: 'ready', label: 'To\nbill', tone: 'good', countKey: 'ready' },
  { key: 'pending_delivery', label: 'Pending\ndelivery', tone: 'brand', countKey: 'pending_delivery' },
  { key: 'delivered', label: 'Delivered\ntoday', tone: 'muted', countKey: 'delivered_today' },
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
  const [error, setError] = useState('');
  const triedFallbackRef = useRef(!!routeFilter);

  const load = useCallback(async (f: FilterKey) => {
    try {
      setError('');
      api.get<Pipe>('/repairs/dashboard').then(setPipe).catch(() => {});
      const res = await api.get<Item[]>(`/repair-items?status=${f}`);
      if (f === 'received' && res.length === 0 && !triedFallbackRef.current) {
        triedFallbackRef.current = true;
        setFilter('with_karigar');
        return;
      }
      setItems(res);
    } catch (e: any) {
      setItems([]);
      setError(e?.detail || 'Failed to load repairs');
    }
    finally { setRefreshing(false); setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const todayISO = todayIST();
  const totalOpen = pipe ? (pipe.received + pipe.with_karigar + pipe.ready + pipe.pending_delivery) : items.length;
  const toneColor = (t: StageTone | string) => (
    t === 'info' ? colors.onInfo : t === 'warn' ? colors.onWarning : t === 'good' ? colors.onSuccess
      : t === 'brand' ? colors.brandSecondary : t === 'muted' ? colors.mutedText : colors.onError
  );
  const toneBg = (t: StageTone | string) => (
    t === 'info' ? colors.info : t === 'warn' ? colors.warning : t === 'good' ? colors.success
      : t === 'brand' ? colors.brandTertiary : t === 'muted' ? colors.surfaceTertiary : colors.error
  );

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
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => load(filter)} testID="repairs-error" />
        ) : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="construct-outline" size={34} color={colors.mutedText} /><Text style={styles.emptyText}>No repairs in this stage</Text></View>
        ) : items.map((i) => {
          const isOverdue = !!i.due_date && i.due_date < todayISO && i.status !== 'delivered' && i.status !== 'pending_delivery';
          // Pill reflects the item's own live stage in the lifecycle.
          const pill: { label: string; tone: StageTone } = isOverdue ? { label: 'Overdue', tone: 'bad' }
            : i.status === 'received' ? { label: 'Pending issue', tone: 'info' }
            : i.status === 'with_karigar' ? { label: 'With karigar', tone: 'warn' }
            : i.status === 'ready' ? { label: 'To bill', tone: 'good' }
            : i.status === 'pending_delivery' ? { label: 'To deliver', tone: 'brand' }
            : i.status === 'delivered' ? { label: 'Delivered', tone: 'muted' }
            : { label: REPAIR_STATUS_LABEL[i.status], tone: 'muted' };
          // One action per stage, moving the tag to its next stage — tapping
          // the tile itself (anywhere else on it) opens the item instead of a
          // separate "Open" button. Delivered is the end of the line, so it
          // gets none; the tile is still tappable to review the record.
          const action = i.status === 'received' ? { label: 'Issue to Karigar', route: `/repairs/item/issue?itemId=${i.id}` }
            : i.status === 'with_karigar' ? { label: 'Receive', route: `/repairs/item/receive?itemId=${i.id}` }
            : i.status === 'ready' ? { label: 'Create bill', route: `/repairs/bill?itemId=${i.id}` }
            : i.status === 'pending_delivery' ? { label: 'Deliver', route: `/repairs/bill?itemId=${i.id}` }
            : null;
          // Extra context per stage — due date always (weight moved up next
          // to the description line), then whichever people/dates matter for
          // that particular stage.
          const detailParts: string[] = [];
          if (i.due_date && i.status !== 'delivered') detailParts.push(`Due ${i.due_date}`);
          if (i.status === 'with_karigar' && i.karigar_name) detailParts.push(`With ${i.karigar_name}`);
          if (i.status === 'delivered') {
            if (i.karigar_name) detailParts.push(`Issued to ${i.karigar_name}`);
            if (i.delivered_by) detailParts.push(`Delivered by ${i.delivered_by}`);
            if (i.delivered_at) detailParts.push(istDateTime(i.delivered_at));
          } else if (i.issued_by) {
            detailParts.push(`Issued by ${i.issued_by}`);
          }
          return (
            <Pressable
              key={i.id}
              onPress={() => router.push(`/repairs/item/${i.id}` as any)}
              style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}
              testID={`item-${i.id}`}
            >
              <View style={styles.itemTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.code}>{i.customer_name}</Text>
                  <Text style={styles.cust} numberOfLines={2}>
                    {i.item_code} · <Text style={styles.cDesc}>{i.description}</Text> · <Text style={styles.cWeight}>{i.gross_weight.toFixed(3)}g</Text>
                  </Text>
                  {!!i.repair_type && <Text style={styles.cType}>{i.repair_type}</Text>}
                  <Text style={styles.detail} numberOfLines={2}>{detailParts.join(' · ')}</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: toneBg(pill.tone) }]}><Text style={[styles.pillText, { color: toneColor(pill.tone) }]}>{pill.label}</Text></View>
              </View>
              {action && (
                <View style={styles.actRow}>
                  <Pressable onPress={() => router.push(action.route as any)} style={[styles.btn, styles.btnPri]} testID={`primary-${i.id}`}>
                    <Text style={styles.btnPriText}>{action.label}</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
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
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  code: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  cust: { color: colors.mutedText, fontSize: 13, marginTop: 1 },
  cDesc: { color: colors.onSurfaceSecondary, fontWeight: '600' },
  cWeight: { color: colors.onSurface, fontWeight: '700' },
  cType: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700', marginTop: 3 },
  detail: { color: colors.onSurfaceTertiary, fontSize: 11.5, marginTop: 3, lineHeight: 15 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  actRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  btn: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  btnPri: { backgroundColor: colors.brandPrimary },
  btnPriText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
});
