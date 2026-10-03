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
import { BASE_CURRENCY, CLAccount, METALS, money, num, initials, orderedCodes, symbol } from '@/src/utils/cashLedger';

// Month rows already show the currency/metal on the left, so metals are just "23.833 g".
const short = (n: number, c: string) => (METALS[c] ? `${num(n, c)} g` : money(n, c));
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

type Totals = Record<string, { you_get: number; you_give: number }>;
type Dash = {
  people: number; open: number; month: string;
  this_month: Record<string, { gave: number; got: number; entries: number }>;
  owe_you_most: { id: string; name: string; balances: Record<string, number> }[];
  you_owe_most: { id: string; name: string; balances: Record<string, number> }[];
  recent: { id: string; account_id: string; account_name: string; direction: 'gave' | 'got'; amount: number; currency: string; date: string; note?: string; conversion_id?: string }[];
};

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
  const [dash, setDash] = useState<Dash | null>(null);
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
      const [r, d] = await Promise.all([
        api.get<{ accounts: CLAccount[]; totals: Totals }>('/khata'),
        api.get<Dash>('/khata-dashboard').catch(() => null),
      ]);
      setRows(r.accounts); setTotals(r.totals); setDash(d);
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => router.push('/cash-ledger/import' as any)} hitSlop={10} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.5 }]} accessibilityLabel="Import from Splitwise" testID="cl-import">
            <Ionicons name="download-outline" size={23} color={colors.brandPrimary} />
          </Pressable>
          <Pressable onPress={() => setAdding(true)} hitSlop={10} style={({ pressed }) => [s.navBtn, pressed && { opacity: 0.5 }]} accessibilityLabel="Add person" testID="cl-add-account">
            <Ionicons name="add" size={26} color={colors.brandPrimary} />
          </Pressable>
          </View>
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

        {/* Dashboard: this month, who owes the most, the latest entries (hidden while searching) */}
        {dash && !ql && dash.people > 0 && (
          <View testID="cl-dashboard">
            <Text style={s.stats}>{dash.people} {dash.people === 1 ? 'person' : 'people'} · {dash.open} with money pending</Text>

            {Object.keys(dash.this_month).length > 0 && (
              <>
                <Text style={s.sectionHeader}>{monthName(dash.month).toUpperCase()}</Text>
                <View style={s.group}>
                  {orderedCodes(dash.this_month as any).map((c, i) => (
                    <View key={c} style={[s.monthRow, i > 0 && s.sepTop]}>
                      <Text style={[s.monthCode, symbol(c).length > 2 && s.monthCodeLong]} numberOfLines={1}>{symbol(c)}</Text>
                      <View style={s.monthCol}>
                        <Text style={s.caption}>YOU GAVE</Text>
                        <Text style={[s.monthAmt, { color: colors.onError }]} numberOfLines={1}>{short(dash.this_month[c].gave, c)}</Text>
                      </View>
                      <View style={s.monthCol}>
                        <Text style={s.caption}>YOU GOT</Text>
                        <Text style={[s.monthAmt, { color: colors.onSuccess }]} numberOfLines={1}>{short(dash.this_month[c].got, c)}</Text>
                      </View>
                      <Text style={s.monthN}>{dash.this_month[c].entries}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {(dash.owe_you_most.length > 0 || dash.you_owe_most.length > 0) && (
              <View style={s.topWrap}>
                {([['OWE YOU THE MOST', dash.owe_you_most, colors.onSuccess], ['YOU OWE THE MOST', dash.you_owe_most, colors.onError]] as const).map(([title, list, color]) => (
                  list.length > 0 && (
                    <View key={title} style={{ flexBasis: '100%' }}>
                      <Text style={[s.sectionHeader, { marginTop: spacing.lg }]}>{title}</Text>
                      <View style={s.group}>
                        {list.map((r, i) => (
                          <Pressable key={r.id} onPress={() => router.push(`/cash-ledger/${r.id}` as any)} style={({ pressed }) => [s.topRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-top-${r.id}`}>
                            <Text style={s.topName} numberOfLines={1}>{r.name}</Text>
                            <Text style={[s.topAmt, { color }]} numberOfLines={1}>{money(r.balances[BASE_CURRENCY], BASE_CURRENCY)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )
                ))}
              </View>
            )}

            {dash.recent.length > 0 && (
              <>
                <Text style={s.sectionHeader}>RECENT</Text>
                <View style={s.group}>
                  {dash.recent.map((e, i) => (
                    <Pressable key={e.id} onPress={() => router.push(`/cash-ledger/${e.account_id}` as any)} style={({ pressed }) => [s.recentRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-recent-${e.id}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.recentName} numberOfLines={1}>{e.account_name}</Text>
                        <Text style={s.subtitle} numberOfLines={1}>{istDisplayDate(e.date)}{e.note ? ` · ${e.note}` : ''}</Text>
                      </View>
                      <Text style={[s.amount, { color: e.conversion_id ? colors.mutedText : e.direction === 'gave' ? colors.onError : colors.onSuccess }]} numberOfLines={1}>
                        {e.direction === 'gave' ? '−' : '+'}{money(e.amount, e.currency)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {!rows ? <ActivityIndicator color={colors.mutedText} style={{ marginTop: 40 }} /> : rows.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="wallet-outline" size={44} color={colors.mutedText} />
            <Text style={s.emptyTitle}>No People</Text>
            <Text style={s.emptyText}>Add someone you give cash to or get cash from. Record each amount, with a photo of the chit if you like.</Text>
            <Pressable onPress={() => setAdding(true)} hitSlop={8} testID="cl-empty-add"><Text style={s.link}>Add Person</Text></Pressable>
            <Pressable onPress={() => router.push('/cash-ledger/import' as any)} hitSlop={8} testID="cl-empty-import"><Text style={s.link}>Import from Splitwise</Text></Pressable>
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
  stats: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, paddingVertical: 10 },
  monthCode: { width: 36, color: colors.onSurfaceSecondary, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  monthCodeLong: { fontSize: 12 },
  monthCol: { flex: 1, minWidth: 0 },
  monthAmt: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  monthN: { color: colors.mutedText, fontSize: 12, minWidth: 22, textAlign: 'right' },
  topWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 44 },
  topName: { flex: 1, color: colors.onSurface, fontSize: 15 },
  topAmt: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 54 },
  recentName: { color: colors.onSurface, fontSize: 16 },
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
