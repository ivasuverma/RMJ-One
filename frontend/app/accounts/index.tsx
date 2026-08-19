import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Screen, Card, DualBalance, Skeleton, EmptyState, ErrorState } from '@/src/components/ui';

// Ledger — the unified account list (v2 Phase 5). One list of accounts across
// every type, with filter chips generated from the account-type master, a
// search box, and net dual totals (fine g + ₹) for the current filter at the
// top. Each row shows the account's own two independent balances. Accounts are
// one entity with a type — not separate customer/karigar/employee directories.
type AccountType = { id: string; name: string; key: string };
type Account = {
  id: string; name: string; type_id: string; type_name: string; phone?: string;
  fine_balance: number; amount_balance: number;
};
type ListResp = { accounts: Account[]; net_fine: number; net_amount: number; count: number };

// A Karigar/Difference account normally has the shop owing gold/absorbing loss,
// so "advance"/"loss" reads better than "advance" everywhere — but direction
// wording is per-row cosmetic; the sign is what's real.
const negLabelForType = (key: string) => (key === 'difference' ? 'loss' : key === 'employee' ? 'advance' : 'payable');

export default function LedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [types, setTypes] = useState<AccountType[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadTypes = useCallback(async () => {
    try { setTypes(await api.get<AccountType[]>('/account-types')); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type_id', typeFilter);
      if (q.trim()) params.set('q', q.trim());
      const path = `/accounts${params.toString() ? `?${params.toString()}` : ''}`;
      setData(await api.get<ListResp>(path));
    } catch (e: any) {
      setError(e?.detail || 'Failed to load accounts');
    } finally { setLoading(false); setRefreshing(false); }
  }, [typeFilter, q]);

  useFocusEffect(useCallback(() => { loadTypes(); }, [loadTypes]));
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const typeKeyById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t.key])), [types]);

  return (
    <Screen scroll={false} testID="ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Ledger</Text>
        <Pressable onPress={() => router.push('/accounts/new' as any)} style={styles.iconBtn} testID="ledger-add-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Net dual totals for the current filter */}
      <View style={styles.totals} testID="ledger-totals">
        <Text style={styles.totalsLabel}>Net for {typeFilter === 'all' ? 'all accounts' : types.find((t) => t.id === typeFilter)?.name || 'filter'}</Text>
        <DualBalance
          fineGrams={data?.net_fine ?? 0}
          amount={data?.net_amount ?? 0}
          negativeLabel="net owed"
        />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={colors.mutedText} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={load}
          placeholder="Search name or phone"
          placeholderTextColor={colors.mutedText}
          style={styles.searchInput}
          returnKeyType="search"
          autoCapitalize="none"
          testID="ledger-search"
        />
        {q.length > 0 && (
          <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={10} testID="ledger-search-clear">
            <Ionicons name="close-circle" size={17} color={colors.mutedText} />
          </Pressable>
        )}
      </View>

      {/* Filter chips generated from the account-type master */}
      <View style={styles.chipsWrap}>
        <FilterChip label="All" active={typeFilter === 'all'} onPress={() => setTypeFilter('all')} testID="ledger-chip-all" />
        {types.map((t) => (
          <FilterChip key={t.id} label={t.name} active={typeFilter === t.id} onPress={() => setTypeFilter(t.id)} testID={`ledger-chip-${t.key}`} />
        ))}
      </View>

      {loading && !data ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} width="100%" height={58} radius={radius.md} />)}
        </View>
      ) : error ? (
        <View style={{ padding: spacing.lg }}><ErrorState message={error} onRetry={load} testID="ledger-error" /></View>
      ) : !data || data.accounts.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title="No accounts yet"
          message={q || typeFilter !== 'all' ? 'Nothing matches this filter.' : 'Create your first ledger account to start tracking fine gold and cash.'}
          actionLabel="Create account"
          onAction={() => router.push('/accounts/new' as any)}
          testID="ledger-empty"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {data.accounts.map((a) => (
            <Card key={a.id} onPress={() => router.push(`/accounts/${a.id}` as any)} testID={`ledger-account-${a.id}`} style={styles.rowCard}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.rowType}>{a.type_name}{a.phone ? ` · ${a.phone}` : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
              </View>
              <DualBalance
                fineGrams={a.fine_balance}
                amount={a.amount_balance}
                negativeLabel={negLabelForType(typeKeyById[a.type_id] || '')}
                size="sm"
              />
            </Card>
          ))}
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </Screen>
  );
}

function FilterChip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },

  totals: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  totalsLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 8 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 10 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  rowCard: { gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { color: colors.onSurface, fontSize: 14.5, fontWeight: '700' },
  rowType: { color: colors.mutedText, fontSize: 11.5, marginTop: 1 },
});
