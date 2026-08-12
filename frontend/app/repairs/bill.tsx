import { useRef, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: 'received' | 'with_karigar' | 'ready' | 'delivered'; billed_amount: number | null;
  payment_mode: string | null; delivered_at?: string;
};

export default function RepairBillLookupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printingId, setPrintingId] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const all = await api.get<Item[]>(`/repair-items?q=${encodeURIComponent(q)}`);
        setResults(all.filter((i) => i.status === 'delivered'));
      } catch (_e) { setResults([]); }
      finally { setLoading(false); setSearched(true); }
    }, 300);
  };

  const viewBill = async (item: Item) => {
    setPrintingId(item.id);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/repair-items/${item.id}/bill/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Bill failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Ready', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrintingId(''); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-bill-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Repair Bill</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.mutedText} />
        <TextInput
          testID="bill-search-input" value={query} onChangeText={search} autoFocus
          placeholder="Search by Tag code, item, or customer" placeholderTextColor={colors.mutedText}
          style={styles.searchInput}
        />
        {loading && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {!searched && !loading && (
          <View style={styles.empty}><Ionicons name="receipt-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>Look up a delivered repair to view or print its bill</Text></View>
        )}
        {searched && results.length === 0 && (
          <View style={styles.empty}><Text style={styles.emptyText}>No delivered repairs match — check the item hasn't just been billed yet</Text></View>
        )}
        {results.map((i) => (
          <View key={i.id} style={styles.itemRow} testID={`bill-result-${i.id}`}>
            <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/repairs/item/${i.id}` as any)}>
              <Text style={styles.cName}>{i.item_code} · {i.customer_name}</Text>
              <Text style={styles.cMeta}>{i.description}{i.billed_amount != null ? ` · ₹${i.billed_amount.toFixed(0)}` : ''}{i.payment_mode ? ` · ${i.payment_mode}` : ''}</Text>
            </Pressable>
            <Pressable onPress={() => viewBill(i)} disabled={printingId === i.id} style={styles.printBtn} testID={`print-bill-${i.id}`}>
              {printingId === i.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
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
  printBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary,
  },
});
