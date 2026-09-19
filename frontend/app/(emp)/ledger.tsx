import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState } from '@/src/components/ui';

// Employee Ledger tab — the counterpart to the owner/admin Ledger tab, same
// row style. Each row only appears when the owner has enabled that module for
// this employee (Settings > Users); the tab itself only appears when at least
// one of them is on (see EmployeeTabBar). "My Ledger" — their own wage and
// advance account — is always listed once the tab is showing.
type Row = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; summary: string };

export default function EmployeeLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [custSummary, setCustSummary] = useState('');
  const [karigarSummary, setKarigarSummary] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasCustomer = hasModule('customer_ledger');
  const hasKarigar = hasModule('karigar_ledger');

  const load = useCallback(async () => {
    // A failed fetch leaves that row's summary as '…' rather than a figure, so
    // a dropped connection never reads as "Nothing owed" — and one banner
    // offers the retry.
    setFailed(false);
    const results = await Promise.allSettled([
      hasCustomer ? api.get<any[]>('/customers').then((cs) => {
        const items = cs.reduce((s, c) => s + (c.open_items || 0), 0);
        const gold = cs.reduce((s, c) => s + (c.open_weight || 0), 0);
        setCustSummary(items > 0 ? `${items} item${items === 1 ? '' : 's'} in · ${gold.toFixed(3)}g held` : 'Nothing open');
      }) : Promise.resolve(),
      hasKarigar ? api.get<any[]>('/karigars').then((ks) => {
        const fine = ks.reduce((s, k) => s + (k.fine_weight_balance || 0), 0);
        const amt = ks.reduce((s, k) => s + (k.amount_due || 0), 0);
        const parts: string[] = [];
        if (Math.abs(fine) >= 0.001) parts.push(`${fine.toFixed(3)}g gold`);
        if (Math.abs(amt) >= 1) parts.push(`₹${Math.abs(Math.round(amt)).toLocaleString('en-IN')}`);
        setKarigarSummary(parts.length ? `Owed: ${parts.join(' · ')}` : 'Nothing owed');
      }) : Promise.resolve(),
    ]);
    if (results.some((r) => r.status === 'rejected')) setFailed(true);
    setRefreshing(false);
  }, [hasCustomer, hasKarigar]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows: Row[] = [];
  rows.push({ key: 'my-ledger', label: 'My Ledger', icon: 'book-outline', route: `/ledger/${user?.id}`, summary: 'Your wages, advances and payments' });
  if (hasCustomer) rows.push({ key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', summary: custSummary || '…' });
  if (hasKarigar) rows.push({ key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', summary: karigarSummary || '…' });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-ledger-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.h1}>Ledger</Text>
        <Text style={styles.sub}>Your account and the ledgers you have access to.</Text>

        {failed && (
          <View style={{ marginTop: spacing.lg }}>
            <ErrorState
              message="Some balances couldn't be loaded, so the figures below may be incomplete."
              onRetry={load}
              testID="emp-ledger-error"
            />
          </View>
        )}

        <Text style={styles.sectionLabel}>Ledgers</Text>
        {rows.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => router.push(r.route as any)}
            style={({ pressed }) => [styles.prow, pressed && { opacity: 0.85 }]}
            testID={`emp-ledger-row-${r.key}`}
          >
            <View style={styles.pi}><Ionicons name={r.icon} size={22} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.pt}>{r.label}</Text>
              <Text style={styles.pd} numberOfLines={1}>{r.summary}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
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
  sectionLabel: {
    color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.md,
  },
  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
});
