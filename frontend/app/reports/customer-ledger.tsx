import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Customer = { id: string; name: string; mobile: string; open_items?: number; open_weight?: number };

// Read-only lookup into a customer's repair history/ledger (customers/[id].tsx).
// Adding/editing customer accounts lives in Settings — this is reporting only.
export default function CustomerLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [onlyBalance, setOnlyBalance] = useState(true);

  const load = useCallback(async (q?: string) => {
    try { setCustomers(await api.get<Customer[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)); }
    catch (_e) { setCustomers([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const withBalanceCount = customers.filter((c) => !!c.open_items).length;
  const visible = (onlyBalance ? customers.filter((c) => !!c.open_items) : customers)
    .slice()
    .sort((a, b) => (b.open_weight || 0) - (a.open_weight || 0));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="customer-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Customer Ledger</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.mutedText} />
        <TextInput
          testID="customer-ledger-search" value={query}
          onChangeText={(v) => { setQuery(v); load(v); }}
          placeholder="Search by name or mobile" placeholderTextColor={colors.mutedText}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.filterRow}>
        <Pressable onPress={() => setOnlyBalance(false)} style={[styles.filterChip, !onlyBalance && styles.filterChipActive]} testID="filter-all">
          <Text style={[styles.filterText, !onlyBalance && styles.filterTextActive]}>All · {customers.length}</Text>
        </Pressable>
        <Pressable onPress={() => setOnlyBalance(true)} style={[styles.filterChip, onlyBalance && styles.filterChipActive]} testID="filter-with-balance">
          <Text style={[styles.filterText, onlyBalance && styles.filterTextActive]}>With Balance · {withBalanceCount}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}>
        {visible.length === 0 ? (
          <View style={styles.empty}><Ionicons name="people-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>{onlyBalance ? 'No one has an open balance right now' : 'No customers found'}</Text></View>
        ) : visible.map((c) => (
          <Pressable key={c.id} onPress={() => router.push(`/customers/${c.id}` as any)} style={styles.card} testID={`customer-ledger-${c.id}`}>
            <View style={styles.iconBox}><Ionicons name="person-outline" size={18} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cName}>{c.name}</Text>
              <Text style={styles.cMeta}>{c.mobile || 'No mobile on file'}</Text>
            </View>
            {!!c.open_items && (
              <View style={styles.balanceBadge}>
                <Text style={styles.balanceValue}>{c.open_weight?.toFixed(3)}g</Text>
                <Text style={styles.balanceLabel}>{c.open_items} pending</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
          </Pressable>
        ))}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 14 },

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
  balanceBadge: { alignItems: 'flex-end', marginRight: spacing.xs },
  balanceValue: { color: colors.onWarning, fontWeight: '700', fontSize: 13 },
  balanceLabel: { color: colors.mutedText, fontSize: 10, marginTop: 1 },
});
