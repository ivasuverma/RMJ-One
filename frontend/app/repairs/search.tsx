import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { REPAIR_STATUS_LABEL, repairStatusColors } from '@/src/utils/repairStatus';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: 'received' | 'with_karigar' | 'ready' | 'delivered'; karigar_name: string | null;
  gross_weight: number; created_at: string; created_by?: string;
};

export default function TagHistorySearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try { setResults(await api.get<Item[]>(`/repair-items?q=${encodeURIComponent(q)}`)); }
      catch (_e) { setResults([]); }
      finally { setLoading(false); setSearched(true); }
    }, 300);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="tag-search-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Tag History</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.mutedText} />
        <TextInput
          testID="tag-search-input" value={query} onChangeText={search} autoFocus
          placeholder="Search by Tag code, item, or customer" placeholderTextColor={colors.mutedText}
          style={styles.searchInput}
        />
        {loading && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {!searched && !loading && (
          <View style={styles.empty}><Ionicons name="pricetag-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>Look up any repair Tag and jump straight into its full history</Text></View>
        )}
        {searched && results.length === 0 && (
          <View style={styles.empty}><Text style={styles.emptyText}>No matching Tags found</Text></View>
        )}
        {results.map((i) => {
          const sc = repairStatusColors(i.status, colors);
          return (
            <Pressable key={i.id} onPress={() => router.push(`/repairs/item/${i.id}` as any)} style={styles.itemRow} testID={`tag-result-${i.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{i.item_code} · {i.customer_name}</Text>
                <Text style={styles.cMeta}>{i.description} · {i.gross_weight.toFixed(3)}g{i.karigar_name ? ` · ${i.karigar_name}` : ''}{i.created_by ? ` · by ${i.created_by}` : ''}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[styles.statusText, { color: sc.fg }]}>{REPAIR_STATUS_LABEL[i.status]}</Text>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 14 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  statusDone: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  statusText: { fontSize: 9, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
