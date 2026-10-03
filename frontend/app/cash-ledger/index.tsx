import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { CLAccount, inr, initials } from '@/src/utils/cashLedger';

type Totals = { you_get: number; you_give: number; net: number };

// Cash Ledger: cash given to and received from people, one account each — a
// khata like Splitwise / Khatabook, separate from the shop's Cash Book. The
// balance is what they owe you (green) or you owe them (red).
export default function CashLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [rows, setRows] = useState<CLAccount[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ accounts: CLAccount[]; totals: Totals }>('/khata');
      setRows(r.accounts); setTotals(r.totals);
    } catch (e: any) { setRows((x) => x || []); if (e?.status !== 403) toast.error('Could not load the Cash Ledger'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = (rows || []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()) || (r.phone || '').includes(q.trim()));

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const a = await api.post<CLAccount>('/khata', { name: name.trim(), phone: phone.trim() });
      setAdding(false); setName(''); setPhone('');
      router.push(`/cash-ledger/${a.id}` as any);
    } catch (e: any) { toast.error(e?.detail || 'Could not add'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cash-ledger-screen">
      <ModuleHeader title="Cash Ledger" backLabel="Ledger" scrolled={scrolled} subtitle="Cash you gave and got, person by person"
        onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        <View style={styles.totals} testID="cl-totals">
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>You&apos;ll get</Text>
            <Text style={[styles.totalValue, { color: colors.onSuccess }]}>{totals ? inr(totals.you_get) : '…'}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>You&apos;ll give</Text>
            <Text style={[styles.totalValue, { color: colors.onError }]}>{totals ? inr(totals.you_give) : '…'}</Text>
          </View>
        </View>

        {(rows?.length || 0) > 6 && (
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={colors.mutedText} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search name or phone" placeholderTextColor={colors.mutedText} style={styles.searchInput} testID="cl-search" />
          </View>
        )}

        {!rows ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="wallet-outline" size={28} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>No one yet</Text>
            <Text style={styles.emptyText}>Add a person, then record the cash you give them and get from them. Attach a photo of the chit or receipt to any entry.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {shown.map((r, i) => {
              const owes = r.balance > 0.004, owe = r.balance < -0.004;
              return (
                <Pressable key={r.id} onPress={() => router.push(`/cash-ledger/${r.id}` as any)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.sep, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={`cl-account-${r.id}`}>
                  <View style={styles.av}><Text style={styles.avText}>{initials(r.name)}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {r.last_date ? `Last entry ${istDisplayDate(r.last_date)}` : 'No entries yet'}{r.entries ? ` · ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.amt, { color: owes ? colors.onSuccess : owe ? colors.onError : colors.mutedText }]}>{owes || owe ? inr(r.balance) : '—'}</Text>
                    <Text style={styles.amtLabel}>{owes ? 'owes you' : owe ? 'you owe' : 'settled'}</Text>
                  </View>
                </Pressable>
              );
            })}
            {shown.length === 0 && <Text style={[styles.sub, { padding: spacing.md }]}>No one matches “{q}”.</Text>}
          </View>
        )}
      </ScrollView>

      <Pressable onPress={() => setAdding(true)} style={styles.fab} testID="cl-add-account">
        <Ionicons name="person-add" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>Add person</Text>
      </Pressable>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add person" testID="cl-add-sheet">
        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Rahul (supplier)" placeholderTextColor={colors.mutedText} style={styles.input} autoFocus testID="cl-new-name" />
        <Text style={styles.label}>Mobile (optional)</Text>
        <TextInput value={phone} onChangeText={setPhone} placeholder="For call / WhatsApp reminder" placeholderTextColor={colors.mutedText} style={styles.input} keyboardType="phone-pad" testID="cl-new-phone" />
        <Pressable onPress={add} disabled={!name.trim() || busy} style={[styles.save, (!name.trim() || busy) && { opacity: 0.5 }]} testID="cl-new-save">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Add</Text>}
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  totals: { flexDirection: 'row', marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: spacing.md },
  totalBox: { flex: 1, alignItems: 'center', gap: 2 },
  totalDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  totalLabel: { color: colors.mutedText, fontSize: 12.5, fontWeight: '600' },
  totalValue: { fontSize: 22, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 10, fontSize: 15 },
  card: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  avText: { color: colors.brandSecondary, fontWeight: '800', fontSize: 14 },
  name: { color: colors.onSurface, fontSize: 15.5, fontWeight: '600' },
  sub: { color: colors.mutedText, fontSize: 12.5, marginTop: 1 },
  amt: { fontSize: 16, fontWeight: '800' },
  amtLabel: { color: colors.mutedText, fontSize: 11.5, marginTop: 1 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: spacing.xl, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.brandPrimary, paddingHorizontal: 18, paddingVertical: 14, borderRadius: radius.pill,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  fabText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16 },
  save: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 16 },
});
