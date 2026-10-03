import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { CurrencyPicker } from '@/src/components/CurrencyPicker';
import { BASE_CURRENCY, CLAccount, money, initials, orderedCodes, symbol } from '@/src/utils/cashLedger';

type Totals = Record<string, { you_get: number; you_give: number }>;

// Cash Ledger: cash given to and received from people, one account each — a
// khata like Splitwise. Separate from everything else in the app (it never
// touches the Cash Book, Home or any other ledger). Laid out like an iOS
// Settings/Contacts list: inset grouped sections, colour only on the money.
export default function CashLedgerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [rows, setRows] = useState<CLAccount[] | null>(null);
  const [totals, setTotals] = useState<Totals>({});
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [currency, setCurrency] = useState(BASE_CURRENCY);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ accounts: CLAccount[]; totals: Totals }>('/khata');
      setRows(r.accounts); setTotals(r.totals);
    } catch (e: any) { setRows((x) => x || []); if (e?.status !== 403) toast.error('Could not load the Cash Ledger'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ql = q.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !ql || r.name.toLowerCase().includes(ql) || (r.phone || '').includes(ql));
  const totalCodes = orderedCodes(Object.fromEntries(Object.keys(totals).map((c) => [c, 1])));

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const a = await api.post<CLAccount>('/khata', { name: name.trim(), phone: phone.trim(), currency });
      setAdding(false); setName(''); setPhone(''); setCurrency(BASE_CURRENCY);
      router.push(`/cash-ledger/${a.id}` as any);
    } catch (e: any) { toast.error(e?.detail || 'Could not add'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="cash-ledger-screen">
      <ModuleHeader title="Cash Ledger" backLabel="Ledger" scrolled={scrolled}
        actions={(
          <Pressable onPress={() => setAdding(true)} hitSlop={10} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.5 }]} accessibilityLabel="Add person" testID="cl-add-account">
            <Ionicons name="add" size={26} color={colors.brandPrimary} />
          </Pressable>
        )} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.mutedText} />}>
        <HeaderSpacer />

        <View style={s.searchField}>
          <Ionicons name="search" size={17} color={colors.mutedText} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.mutedText} style={s.searchInput}
            clearButtonMode="while-editing" testID="cl-search" />
        </View>

        {/* Totals: one line per currency, never added together */}
        <View style={[s.group, s.totals]} testID="cl-totals">
          <View style={s.totalCol}>
            <Text style={s.caption}>YOU&apos;LL GET</Text>
            {totalCodes.some((c) => totals[c].you_get) ? totalCodes.filter((c) => totals[c].you_get).map((c) => (
              <Text key={c} style={[s.totalValue, { color: colors.onSuccess }]}>{money(totals[c].you_get, c)}</Text>
            )) : <Text style={[s.totalValue, { color: colors.mutedText }]}>{money(0)}</Text>}
          </View>
          <View style={s.totalDivider} />
          <View style={s.totalCol}>
            <Text style={s.caption}>YOU&apos;LL GIVE</Text>
            {totalCodes.some((c) => totals[c].you_give) ? totalCodes.filter((c) => totals[c].you_give).map((c) => (
              <Text key={c} style={[s.totalValue, { color: colors.onError }]}>{money(totals[c].you_give, c)}</Text>
            )) : <Text style={[s.totalValue, { color: colors.mutedText }]}>{money(0)}</Text>}
          </View>
        </View>

        {!rows ? <ActivityIndicator color={colors.mutedText} style={{ marginTop: 40 }} /> : rows.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="wallet-outline" size={44} color={colors.mutedText} />
            <Text style={s.emptyTitle}>No People</Text>
            <Text style={s.emptyText}>Add someone you give cash to or get cash from. Record each amount, with a photo of the chit if you like.</Text>
            <Pressable onPress={() => setAdding(true)} hitSlop={8} testID="cl-empty-add"><Text style={s.link}>Add Person</Text></Pressable>
          </View>
        ) : (
          <>
            <Text style={s.sectionHeader}>PEOPLE</Text>
            <View style={s.group}>
              {shown.map((r, i) => {
                const codes = orderedCodes(r.balances);
                return (
                  <Pressable key={r.id} onPress={() => router.push(`/cash-ledger/${r.id}` as any)}
                    style={({ pressed }) => [s.row, pressed && s.pressed]} testID={`cl-account-${r.id}`}>
                    <View style={s.av}><Text style={s.avText}>{initials(r.name)}</Text></View>
                    <View style={[s.rowBody, i > 0 && s.sepTop]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.title} numberOfLines={1}>{r.name}</Text>
                        <Text style={s.subtitle} numberOfLines={1}>{r.last_date ? istDisplayDate(r.last_date) : 'No entries'}</Text>
                      </View>
                      <View style={s.trailing}>
                        {codes.length ? codes.slice(0, 2).map((c) => (
                          <Text key={c} style={[s.amount, { color: r.balances[c] > 0 ? colors.onSuccess : colors.onError }]}>{money(r.balances[c], c)}</Text>
                        )) : <Text style={s.settled}>Settled</Text>}
                        {codes.length > 2 && <Text style={s.subtitle}>+{codes.length - 2} more</Text>}
                      </View>
                      <Ionicons name="chevron-forward" size={17} color={colors.mutedText} style={{ opacity: 0.6 }} />
                    </View>
                  </Pressable>
                );
              })}
              {shown.length === 0 && <Text style={[s.subtitle, { padding: spacing.md }]}>No results for “{q}”</Text>}
            </View>
            <Text style={s.footer}>Green: they owe you. Red: you owe them.</Text>
          </>
        )}
      </ScrollView>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="New Person" testID="cl-add-sheet">
        <View style={s.formGroup}>
          <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.mutedText} style={s.formInput} autoFocus testID="cl-new-name" />
          <View style={s.formSep} />
          <TextInput value={phone} onChangeText={setPhone} placeholder="Mobile (optional)" placeholderTextColor={colors.mutedText} style={s.formInput} keyboardType="phone-pad" testID="cl-new-phone" />
          <View style={s.formSep} />
          <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [s.formRow, pressed && s.pressed]} testID="cl-new-currency">
            <Text style={s.formLabel}>Currency</Text>
            <Text style={s.formValue}>{symbol(currency)} {currency}</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.mutedText} style={{ opacity: 0.6 }} />
          </Pressable>
        </View>
        <Pressable onPress={add} disabled={!name.trim() || busy} style={({ pressed }) => [s.primary, (!name.trim() || busy) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]} testID="cl-new-save">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.primaryText}>Add</Text>}
        </Pressable>
      </Sheet>
      <CurrencyPicker visible={picking} value={currency} onPick={(c) => { setCurrency(c); setPicking(false); }} onClose={() => setPicking(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 8, fontSize: 17, ...({ outlineStyle: 'none' } as any) },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  totals: { flexDirection: 'row', marginTop: spacing.lg, paddingVertical: 14 },
  totalCol: { flex: 1, alignItems: 'center', gap: 2 },
  totalDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  caption: { color: colors.mutedText, fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  totalValue: { fontSize: 22, fontWeight: '600', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  sectionHeader: { color: colors.mutedText, fontSize: 13, letterSpacing: 0.2, marginTop: spacing.xl, marginBottom: 6, marginLeft: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md },
  pressed: { backgroundColor: colors.surfaceTertiary },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  avText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 15 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12, paddingVertical: 11, paddingRight: spacing.md, minHeight: 60 },
  sepTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  title: { color: colors.onSurface, fontSize: 17, letterSpacing: -0.2 },
  subtitle: { color: colors.mutedText, fontSize: 13, marginTop: 1 },
  trailing: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  settled: { color: colors.mutedText, fontSize: 15 },
  footer: { color: colors.mutedText, fontSize: 13, marginTop: 8, marginHorizontal: spacing.md },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.xl, gap: 8 },
  emptyTitle: { color: colors.onSurface, fontSize: 22, fontWeight: '700', marginTop: 6 },
  emptyText: { color: colors.mutedText, fontSize: 15, textAlign: 'center', lineHeight: 20 },
  link: { color: colors.brandPrimary, fontSize: 17, marginTop: 6 },
  formGroup: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  formInput: { color: colors.onSurface, fontSize: 17, paddingHorizontal: spacing.md, paddingVertical: 13, ...({ outlineStyle: 'none' } as any) },
  formSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: spacing.md },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, minHeight: 48 },
  formLabel: { flex: 1, color: colors.onSurface, fontSize: 17 },
  formValue: { color: colors.mutedText, fontSize: 17 },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 17 },
});
