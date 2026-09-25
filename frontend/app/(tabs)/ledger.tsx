import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';
import { TabBarSpacer } from '@/src/components/GlassTabBar';
import { StickyHeader, useScrolled } from '@/src/components/ui/StickyHeader';

// Ledger tab (owner/admin/accountant). The books, grouped by what they are about:
//   People — the customer, karigar and employee ledgers (each party's own account)
//   Books  — the Day Book: every entry from every book in one list
//   Gold   — the shop's own gold stock, and losses
// (Cash is in the Cash Book on the Work tab.) Each row carries a live summary. Rows can be reordered within
// their group and hidden; that choice is saved per person on the server, so it follows them to any device.
type Row = { key: string; group: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; summary: string };

const GROUPS = ['People', 'Books', 'Gold'];
const ORDER_KEY = 'rmj.ledger_order';    // the old per-device choice — read once and moved to the server
const HIDDEN_KEY = 'rmj.ledger_hidden';

const inr = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;

export default function LedgerScreen() {
  const { scrolled, onScroll } = useScrolled();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [editOrder, setEditOrder] = useState(false);
  const [sum, setSum] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const savePrefs = (o: string[], h: string[]) => { api.put('/me/ui-prefs', { ledger_order: o, ledger_hidden: h }).catch(() => {}); };
  const persistOrder = (keys: string[]) => { setOrder(keys); savePrefs(keys, hidden); };
  const toggleHidden = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next); savePrefs(order, next);
  };

  // This person's saved layout — falling back to (and migrating) whatever this browser remembered before.
  const loadPrefs = useCallback(async () => {
    try {
      const p = await api.get<{ ledger_order: string[]; ledger_hidden: string[] }>('/me/ui-prefs');
      if (p.ledger_order.length || p.ledger_hidden.length) { setOrder(p.ledger_order); setHidden(p.ledger_hidden); return; }
      const lo = typeof window !== 'undefined' ? JSON.parse(window.localStorage.getItem(ORDER_KEY) || '[]') : [];
      const lh = typeof window !== 'undefined' ? JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || '[]') : [];
      if (lo.length || lh.length) { setOrder(lo); setHidden(lh); savePrefs(lo, lh); }
    } catch { /* keep the default layout */ }
  }, []);

  const load = useCallback(async () => {
    // Two small calls instead of pulling whole customer/karigar/employee lists just to add them up. A row that
    // couldn't load shows '…', never a figure, and one banner offers a retry.
    setFailed(false);
    const [s, e] = await Promise.allSettled([
      api.get<any>('/ledger-summary'),
      api.get<{ closing_balance?: number }[]>('/employees'),
    ]);
    const next: Record<string, string> = {};
    if (s.status === 'fulfilled') {
      const r = s.value;
      next['customer-ledger'] = r.customer.open_items > 0 ? `${r.customer.open_items} item${r.customer.open_items === 1 ? '' : 's'} in · ${r.customer.open_weight.toFixed(3)}g held` : 'Nothing open';
      const parts: string[] = [];
      if (Math.abs(r.karigar.fine) >= 0.001) parts.push(`${r.karigar.fine.toFixed(3)}g gold`);
      if (Math.abs(r.karigar.amount) >= 1) parts.push(inr(r.karigar.amount));
      next['karigar-ledger'] = parts.length ? `Owed: ${parts.join(' · ')}` : 'Nothing owed';
      next['loss-ledger'] = Math.abs(r.loss.fine) >= 0.001 ? `${r.loss.weight.toFixed(3)}g weight · ${r.loss.fine.toFixed(3)}g fine` : 'No loss recorded';
      next['metal-ledger'] = `${r.metal.balance.toFixed(3)}g ${r.metal.has_opening ? 'stock' : 'net movement'}${Math.abs(r.metal.loss) >= 0.001 ? ` · ${r.metal.loss.toFixed(3)}g loss` : ''}`;
    } else setFailed(true);
    if (e.status === 'fulfilled') {
      const withBalance = e.value.filter((x) => !!x.closing_balance);
      const total = withBalance.reduce((t, x) => t + Math.abs(x.closing_balance || 0), 0);
      next['employee-ledger'] = withBalance.length > 0 ? `${withBalance.length} with balance · ${inr(total)}` : 'All settled';
    } else setFailed(true);
    setSum(next);
    setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); loadPrefs(); }, [load, loadPrefs]));

  const rows: Row[] = [
    { key: 'customer-ledger', group: 'People', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', summary: sum['customer-ledger'] || '…' },
    { key: 'karigar-ledger', group: 'People', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', summary: sum['karigar-ledger'] || '…' },
    { key: 'employee-ledger', group: 'People', label: 'Employee Ledger', icon: 'people-outline', route: '/reports/employee-ledger', summary: sum['employee-ledger'] || '…' },
    { key: 'day-book', group: 'Books', label: 'Day Book', icon: 'journal-outline', route: '/reports/day-book', summary: 'Every entry from every book, newest first' },
    { key: 'metal-ledger', group: 'Gold', label: 'Metal Ledger', icon: 'diamond-outline', route: '/reports/metal-ledger', summary: sum['metal-ledger'] || '…' },
    { key: 'loss-ledger', group: 'Gold', label: 'Loss Ledger', icon: 'trending-down-outline', route: '/reports/loss-ledger', summary: sum['loss-ledger'] || '…' },
  ];

  const idx = (k: string) => { const i = order.indexOf(k); return i === -1 ? 999 : i; };
  const inGroup = (g: string) => rows.filter((r) => r.group === g).sort((a, b) => idx(a.key) - idx(b.key));
  // Move within the group only (the group order is fixed).
  const move = (group: string, key: string, dir: -1 | 1) => {
    const keys = inGroup(group).map((r) => r.key);
    const i = keys.indexOf(key); const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    persistOrder([...order.filter((k) => !keys.includes(k)), ...keys]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ledger-screen">
      <StickyHeader scrolled={scrolled}>
        <View style={styles.titleRow}>
          <Text style={styles.h1}>Ledger</Text>
          <Pressable onPress={() => setEditOrder((v) => !v)} hitSlop={8} testID="ledger-edit-order">
            <Text style={styles.editOrderText}>{editOrder ? 'Done' : 'Edit'}</Text>
          </Pressable>
        </View>
        <Text style={styles.sub}>Customer, karigar and employee accounts, the Day Book, and the shop’s gold. Cash is in the Cash Book (Work tab).</Text>
      </StickyHeader>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >

        {failed && (
          <View style={{ marginTop: spacing.lg }}>
            <ErrorState message="Some balances couldn't be loaded, so the figures below may be incomplete." onRetry={load} testID="ledger-error" />
          </View>
        )}

        {GROUPS.map((g) => {
          const list = inGroup(g);
          const shown = editOrder ? list : list.filter((r) => !hidden.includes(r.key));
          if (shown.length === 0) return null;
          return (
            <View key={g}>
              <Text style={styles.sectionLabel}>{g}</Text>
              {shown.map((r, ri) => {
                const isHidden = hidden.includes(r.key);
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => !editOrder && router.push(r.route as any)}
                    style={({ pressed }) => [styles.prow, isHidden && editOrder && styles.prowHidden, pressed && !editOrder && { opacity: 0.85 }]}
                    testID={`ledger-row-${r.key}`}
                  >
                    <View style={styles.pi}><Ionicons name={r.icon} size={22} color={colors.brandSecondary} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.pt}>{r.label}</Text>
                      <Text style={styles.pd} numberOfLines={1}>{r.summary}</Text>
                    </View>
                    {editOrder ? (
                      <View style={styles.reorderCtrls}>
                        <Pressable onPress={() => toggleHidden(r.key)} style={styles.arrowBtn} hitSlop={6} testID={`ledger-hide-${r.key}`}>
                          <Ionicons name={isHidden ? 'eye-off-outline' : 'eye-outline'} size={16} color={isHidden ? colors.mutedText : colors.onSurface} />
                        </Pressable>
                        <Pressable onPress={() => move(g, r.key, -1)} disabled={ri === 0} style={[styles.arrowBtn, ri === 0 && { opacity: 0.3 }]} hitSlop={6} testID={`ledger-up-${r.key}`}><Ionicons name="chevron-up" size={18} color={colors.onSurface} /></Pressable>
                        <Pressable onPress={() => move(g, r.key, 1)} disabled={ri === shown.length - 1} style={[styles.arrowBtn, ri === shown.length - 1 && { opacity: 0.3 }]} hitSlop={6} testID={`ledger-down-${r.key}`}><Ionicons name="chevron-down" size={18} color={colors.onSurface} /></Pressable>
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        <TabBarSpacer />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  h1: { color: colors.onSurface, fontSize: 30, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  sectionLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.md },
  editOrderText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700', paddingBottom: 6 },
  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  prowHidden: { opacity: 0.45 },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  reorderCtrls: { flexDirection: 'row', gap: 4 },
  arrowBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
});
