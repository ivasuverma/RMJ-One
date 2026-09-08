import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Ledger tab (owner/admin/accountant) — the account ledgers, moved here
// from Settings > Reports so they're one tap away instead of buried two
// levels deep. Settings > Reports is gone entirely now (its remaining
// tile, Custom PDF Report, moved to the Payroll tab header instead).
// Metal Ledger is the shop's own gold stock — the double-entry counter
// side of every gold_out/gold_in posted to a karigar's ledger.
//
// Rows/reorder/summary style deliberately matches the Work tab's "In
// progress" board (same prow/pi/pt/pd row shape, same tap-to-move reorder
// UI, same per-row live summary instead of a bare label) rather than the
// plain icon-grid Reports uses, per direct request.
type Row = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; summary: string };

const ORDER_KEY = 'rmj.ledger_order';

export default function LedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [order, setOrder] = useState<string[]>([]);
  const [editOrder, setEditOrder] = useState(false);
  const [custSummary, setCustSummary] = useState('');
  const [karigarSummary, setKarigarSummary] = useState('');
  const [cashSummary, setCashSummary] = useState('');
  const [lossSummary, setLossSummary] = useState('');
  const [metalSummary, setMetalSummary] = useState('');
  const [employeeSummary, setEmployeeSummary] = useState('');

  useFocusEffect(useCallback(() => {
    try { const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORDER_KEY) : null; if (raw) setOrder(JSON.parse(raw)); } catch { /* ignore */ }
  }, []));
  const persistOrder = (keys: string[]) => { setOrder(keys); try { if (typeof window !== 'undefined') window.localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch { /* ignore */ } };

  useFocusEffect(useCallback(() => {
    api.get<any[]>('/customers').then((cs) => {
      const items = cs.reduce((s, c) => s + (c.open_items || 0), 0);
      const gold = cs.reduce((s, c) => s + (c.open_weight || 0), 0);
      setCustSummary(items > 0 ? `${items} item${items === 1 ? '' : 's'} in · ${gold.toFixed(3)}g held` : 'Nothing open');
    }).catch(() => {});
    api.get<any[]>('/karigars').then((ks) => {
      const fine = ks.reduce((s, k) => s + (k.fine_weight_balance || 0), 0);
      const amt = ks.reduce((s, k) => s + (k.amount_due || 0), 0);
      const parts: string[] = [];
      if (Math.abs(fine) >= 0.001) parts.push(`${fine.toFixed(3)}g gold`);
      if (Math.abs(amt) >= 1) parts.push(`₹${Math.abs(Math.round(amt)).toLocaleString('en-IN')}`);
      setKarigarSummary(parts.length ? `Owed: ${parts.join(' · ')}` : 'Nothing owed');
    }).catch(() => {});
    api.get<{ total_received: number; total_paid_out: number; net: number }>('/cash-ledger').then((r) => {
      setCashSummary(`Net ₹${Math.round(r.net).toLocaleString('en-IN')} · ${r.total_received > 0 || r.total_paid_out > 0 ? `₹${Math.round(r.total_received).toLocaleString('en-IN')} in, ₹${Math.round(r.total_paid_out).toLocaleString('en-IN')} out` : 'No activity'}`);
    }).catch(() => {});
    api.get<{ total_weight: number; total_fine_weight: number }>('/karigars/loss-ledger').then((r) => {
      setLossSummary(Math.abs(r.total_fine_weight) >= 0.001 ? `${r.total_weight.toFixed(3)}g weight · ${r.total_fine_weight.toFixed(3)}g fine` : 'No loss recorded');
    }).catch(() => {});
    api.get<{ balance: number; total_loss: number }>('/metal-ledger').then((r) => {
      const parts = [`${r.balance.toFixed(3)}g net stock`];
      if (Math.abs(r.total_loss) >= 0.001) parts.push(`${r.total_loss.toFixed(3)}g loss`);
      setMetalSummary(parts.join(' · '));
    }).catch(() => {});
    api.get<{ closing_balance?: number }[]>('/employees').then((es) => {
      const withBalance = es.filter((e) => !!e.closing_balance);
      const total = withBalance.reduce((s, e) => s + Math.abs(e.closing_balance || 0), 0);
      setEmployeeSummary(withBalance.length > 0 ? `${withBalance.length} with balance · ₹${Math.round(total).toLocaleString('en-IN')}` : 'All settled');
    }).catch(() => {});
  }, []));

  const rows: Row[] = [
    { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', summary: custSummary || '…' },
    { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', summary: karigarSummary || '…' },
    { key: 'cash-ledger', label: 'Cash Ledger', icon: 'cash-outline', route: '/reports/cash-ledger', summary: cashSummary || '…' },
    { key: 'loss-ledger', label: 'Loss Ledger', icon: 'trending-down-outline', route: '/reports/loss-ledger', summary: lossSummary || '…' },
    { key: 'metal-ledger', label: 'Metal Ledger', icon: 'diamond-outline', route: '/reports/metal-ledger', summary: metalSummary || '…' },
    { key: 'employee-ledger', label: 'Employee Ledger', icon: 'people-outline', route: '/reports/employee-ledger', summary: employeeSummary || '…' },
  ];

  const idx = (k: string) => { const i = order.indexOf(k); return i === -1 ? 999 : i; };
  const sortedRows = [...rows].sort((a, b) => idx(a.key) - idx(b.key));
  const move = (key: string, dir: -1 | 1) => {
    const keys = sortedRows.map((r) => r.key);
    const i = keys.indexOf(key); const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    persistOrder(keys);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ledger-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Ledger</Text>
        <Text style={styles.sub}>Customer, karigar, cash, loss, metal, and employee accounts.</Text>

        <View style={styles.progressHead}>
          <Text style={styles.sectionLabel}>Ledgers</Text>
          <Pressable onPress={() => setEditOrder((v) => !v)} hitSlop={8} testID="ledger-edit-order">
            <Text style={styles.editOrderText}>{editOrder ? 'Done' : 'Reorder'}</Text>
          </Pressable>
        </View>

        {sortedRows.map((r, ri) => (
          <Pressable
            key={r.key}
            onPress={() => !editOrder && router.push(r.route as any)}
            style={({ pressed }) => [styles.prow, pressed && !editOrder && { opacity: 0.85 }]}
            testID={`ledger-row-${r.key}`}
          >
            <View style={styles.pi}><Ionicons name={r.icon} size={22} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.pt}>{r.label}</Text>
              <Text style={styles.pd} numberOfLines={1}>{r.summary}</Text>
            </View>
            {editOrder ? (
              <View style={styles.reorderCtrls}>
                <Pressable onPress={() => move(r.key, -1)} disabled={ri === 0} style={[styles.arrowBtn, ri === 0 && { opacity: 0.3 }]} hitSlop={6} testID={`ledger-up-${r.key}`}><Ionicons name="chevron-up" size={18} color={colors.onSurface} /></Pressable>
                <Pressable onPress={() => move(r.key, 1)} disabled={ri === sortedRows.length - 1} style={[styles.arrowBtn, ri === sortedRows.length - 1 && { opacity: 0.3 }]} hitSlop={6} testID={`ledger-down-${r.key}`}><Ionicons name="chevron-down" size={18} color={colors.onSurface} /></Pressable>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
            )}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  h1: { color: colors.onSurface, fontSize: 30, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.md,
  },
  editOrderText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.md },
  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  reorderCtrls: { flexDirection: 'row', gap: 4 },
  arrowBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
});
